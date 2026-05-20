import {
  readdir,
  mkdir,
  mkdtemp,
  writeFile,
  rm,
  rename,
  cp,
  symlink,
  readlink,
  copyFile,
} from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { log, exists, run, renderTemplate } from './utils.js';

const FRAMEWORKS = new Set(['sveltekit', 'nextjs']);

export default async function build() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const nativeDir = join(cwd, 'native');
  if (!await exists(nativeDir)) {
    throw new Error(`native/ directory not found in ${cwd}`);
  }

  const workdir = await mkdtemp(join(tmpdir(), 'fsn-build-'));
  log(`workdir: ${workdir}`);

  // 1. Copy the whole project → workdir (skip node_modules, prior build
  //    output, and SCM noise). Bringing the project root along means pnpm
  //    picks up the consumer's pnpm-workspace.yaml — including its
  //    `allowBuilds` approvals — during the install in step 2.
  await copyTree(cwd, workdir, [
    'node_modules',
    '.next',
    '.svelte-kit',
    'build',
    'out',
    'dist',
    '.git',
  ]);
  const workNative = join(workdir, 'native');

  // 2. Install + build the framework.
  await run('pnpm', ['install', '--prefer-offline'], { cwd: workNative });
  await run('pnpm', ['build'], { cwd: workNative });

  // 3. Stage the framework's runtime artifacts under a single workdir/app/
  //    directory and drop a fsn.handler.mjs alongside them. The Electron
  //    main only ever imports './app/fsn.handler.mjs' — every framework-
  //    specific detail (which file exports the handler, where node_modules
  //    lives) is confined to the handler module.
  const appDir = join(workdir, 'app');
  if (config.type === 'sveltekit') {
    const adapterOut = join(workNative, 'build');
    if (!await exists(adapterOut)) {
      throw new Error(`Expected adapter-node output at ${adapterOut} but didn't find it.`);
    }
    await rename(adapterOut, appDir);
    // adapter-node's handler.js is ESM. Mark the dir as ESM via a
    // package.json so Node skips the reparse-from-CJS perf warning, and
    // re-export the handler under our canonical name.
    await writeFile(
      join(appDir, 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2) + '\n'
    );
    // Wrap adapter-node's Polka middleware so fsn.handler.mjs exports the
    // same (req, res) => Promise<void> shape that next's getRequestHandler
    // gives us — the Electron main never has to branch on framework.
    await writeFile(
      join(appDir, 'fsn.handler.mjs'),
      `import { handler as middleware } from './handler.js';\n\nexport const handler = (req, res) => new Promise((resolve, reject) => {\n  const done = (err) => (err ? reject(err) : resolve());\n  res.once('finish', () => done());\n  res.once('close', () => done());\n  try {\n    middleware(req, res, (err) => {\n      if (err) return done(err);\n      if (!res.writableEnded) {\n        res.statusCode = 404;\n        res.end('Not found');\n      }\n    });\n  } catch (err) {\n    done(err);\n  }\n});\n`
    );
    await rm(workNative, { recursive: true, force: true });
  } else if (config.type === 'nextjs') {
    const nextOut = join(workNative, '.next');
    if (!await exists(nextOut)) {
      throw new Error(`Expected next build output at ${nextOut} but didn't find it.`);
    }
    // pnpm's isolated install leaves workdir/native/node_modules full of
    // symlinks pointing up into workdir/node_modules/.pnpm — that breaks
    // require() once the tree is asar-bundled. `pnpm deploy` rewrites the
    // tree with all prod deps fully inlined and devDeps stripped, using
    // --node-linker=hoisted so node_modules is flat (no .pnpm subdir).
    await run('pnpm', ['--filter', 'native', 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', appDir], { cwd: workdir });
    // pnpm deploy only copies the package's published files. Layer the
    // build output and runtime-relevant config/assets back on.
    await cp(nextOut, join(appDir, '.next'), { recursive: true });
    for (const dir of ['public', 'src']) {
      const src = join(workNative, dir);
      if (await exists(src)) await cp(src, join(appDir, dir), { recursive: true });
    }
    for (const cfg of ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next-env.d.ts', 'tsconfig.json']) {
      const src = join(workNative, cfg);
      if (await exists(src)) await cp(src, join(appDir, cfg));
    }
    // Strip dev-only / SCM noise that snuck through copyTree's filter.
    for (const junk of ['.git', '.gitignore', 'README.md', 'AGENTS.md', 'CLAUDE.md']) {
      await rm(join(appDir, junk), { recursive: true, force: true });
    }
    // Write the FSN handler module. Mirrors the user-authored shape so the
    // Electron main can dynamic-import it just like adapter-node's output.
    await writeFile(
      join(appDir, 'fsn.handler.mjs'),
      `import createNextServer from 'next';\n\nconst nextjs = createNextServer({\n  dev: false,\n  dir: import.meta.dirname,\n});\n\nawait nextjs.prepare();\n\nexport const handler = nextjs.getRequestHandler();\n`
    );
    await rm(workNative, { recursive: true, force: true });
  }
  // Clear consumer-only files at workdir root (their package.json,
  // fsn.config.js, pnpm-workspace.yaml, .gitignore, the pnpm-hoist
  // node_modules, …) — only the unified app/ dir survives.
  for (const entry of await readdir(workdir)) {
    if (entry !== 'app') {
      await rm(join(workdir, entry), { recursive: true, force: true });
    }
  }

  // 4. Write the Electron main process
  await writeFile(
    join(workdir, 'application.js'),
    await renderTemplate('application.template.js', { $$projectName: JSON.stringify(basename(cwd)) })
  );

  // 5. Write a package.json for the Electron app and install Electron +
  //    @electron/packager. We use npm here (not pnpm) because the workdir
  //    is throwaway and npm doesn't gate Electron's post-install download.
  const appName = sanitizeAppName(basename(cwd));
  await writeFile(
    join(workdir, 'package.json'),
    JSON.stringify(
      {
        name: appName,
        version: '0.0.0',
        private: true,
        main: 'application.js',
      },
      null,
      2
    ) + '\n'
  );

  await run('npm', ['install', '--no-audit', '--no-fund', '--save-dev',
    'electron@latest',
    '@electron/packager@latest',
  ], { cwd: workdir });

  // 6. Package the app
  const platform = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'win32' : 'linux';
  await run('npx', ['--yes', '@electron/packager', '.', appName,
    '--out', 'dist',
    '--overwrite',
    '--platform', platform,
    '--arch', process.arch,
  ], { cwd: workdir });

  // 7. Copy result back to ./dist
  const projectDist = join(cwd, 'dist');
  if (await exists(projectDist)) {
    await rm(projectDist, { recursive: true, force: true });
  }
  await cp(join(workdir, 'dist'), projectDist, { recursive: true });

  log(`✓ Built native app at ${projectDist}`);
}

/** @param {string} cwd */
async function loadConfig(cwd) {
  const configPath = join(cwd, 'fsn.config.js');
  if (!await exists(configPath)) {
    throw new Error(`fsn.config.js not found in ${cwd}`);
  }
  const mod = await import(pathToFileURL(configPath).href);
  const config = mod.default || mod;
  if (!config || !FRAMEWORKS.has(config.type)) {
    throw new Error(
      `fsn.config.js must default-export { type: 'sveltekit' | 'nextjs' }`
    );
  }
  return config;
}

/** @param {string} name */
function sanitizeAppName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string[]} exclude
 */
async function copyTree(src, dest, exclude = []) {
  const skip = new Set(exclude);
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(s, d, exclude);
    } else if (entry.isSymbolicLink()) {
      await symlink(await readlink(s), d);
    } else {
      await copyFile(s, d);
    }
  }
}
