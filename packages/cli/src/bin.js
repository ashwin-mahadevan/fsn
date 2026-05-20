#!/usr/bin/env node

import {
  access,
  readdir,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  rename,
  cp,
  symlink,
  readlink,
  copyFile,
} from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FRAMEWORKS = new Set(['sveltekit', 'nextjs']);

const USAGE = `fsn — Full-Stack Native

Commands:
  fsn <project-name> init <sveltekit|nextjs>   Scaffold a new FSN project.
  fsn build                                    Build the current project into a native app.
`;

function log(...args) {
  process.stderr.write('[fsn] ' + args.join(' ') + '\n');
}

const exists = (p) => access(p).then(() => true, () => false);

async function run(cmd, args, options = {}) {
  log('$', cmd, args.join(' '), options.cwd ? `(cwd=${options.cwd})` : '');
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...options });
  const code = await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${code}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '--help' || argv[0] === '-h' || argv.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  if (argv[0] === 'build' && argv.length === 1) {
    return await build();
  }

  if (argv.length === 3 && argv[1] === 'init') {
    const [projectName, , framework] = argv;
    if (!FRAMEWORKS.has(framework)) {
      throw new Error(`Unknown framework "${framework}". Expected one of: ${[...FRAMEWORKS].join(', ')}`);
    }
    return await init(projectName, framework);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// fsn <project-name> init <framework>
// ---------------------------------------------------------------------------

async function init(projectName, framework) {
  const projectDir = resolve(projectName);
  if (await exists(projectDir)) {
    const entries = await readdir(projectDir);
    if (entries.length > 0) {
      throw new Error(`${projectDir} already exists and is not empty.`);
    }
  } else {
    await mkdir(projectDir, { recursive: true });
  }

  if (framework === 'sveltekit') {
    await scaffoldSveltekit(projectDir);
  } else if (framework === 'nextjs') {
    await scaffoldNextjs(projectDir);
  }

  await writeWorkspaceFiles(projectDir, projectName, framework);

  log(`done. Next:`);
  log(`  cd ${projectName}`);
  log(`  pnpm install`);
  log(`  pnpm build`);
}

async function scaffoldSveltekit(projectDir) {
  // sv create scaffolds into ./<dir>; we run it with cwd=projectDir so the
  // skeleton lands in projectDir/native.
  await run('pnpm', [
    'dlx',
    'sv@latest',
    'create',
    'native',
    '--template', 'demo',
    '--types', 'ts',
    '--no-add-ons',
    '--no-install',
    '--no-dir-check',
    '--no-download-check',
  ], { cwd: projectDir });

  const nativeDir = join(projectDir, 'native');

  // Swap the default adapter-auto for adapter-node so `pnpm build` emits a
  // runnable Node server that the Electron main process can host — this is
  // the whole point of FSN: ship fullstack frameworks, not static exports.
  // `sv add` rewrites svelte.config.js and the package.json devDep for us.
  await run('pnpm', [
    'dlx',
    'sv@latest',
    'add',
    'sveltekit-adapter=adapter:node',
    '-C', nativeDir,
    '--no-install',
    '--no-git-check',
    '--no-download-check',
  ]);
}

async function scaffoldNextjs(projectDir) {
  // create-next-app doesn't accept a relative path with trailing components;
  // running it with cwd=projectDir lands the project in projectDir/native.
  await run('pnpm', [
    'dlx',
    'create-next-app@latest',
    'native',
    '--yes',
    '--ts',
    '--eslint',
    '--app',
    '--src-dir',
    '--no-tailwind',
    '--import-alias', '@/*',
    '--use-pnpm',
    '--skip-install',
    '--disable-git',
  ], { cwd: projectDir });

  const nativeDir = join(projectDir, 'native');

  // create-next-app drops its own pnpm-workspace.yaml inside the package to
  // suppress postinstall scripts. Our parent already controls those via
  // `onlyBuiltDependencies`, and a nested workspace yaml confuses pnpm.
  const nestedWs = join(nativeDir, 'pnpm-workspace.yaml');
  if (await exists(nestedWs)) await rm(nestedWs);
}

async function writeWorkspaceFiles(projectDir, projectName, framework) {
  await writeFile(
    join(projectDir, 'pnpm-workspace.yaml'),
    `packages:\n  - native\n\nonlyBuiltDependencies:\n  - electron\n`
  );

  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: basename(projectName),
        private: true,
        version: '0.0.0',
        scripts: {
          build: 'fsn build',
        },
        devDependencies: {
          '@fsn.dev/cli': '*',
        },
      },
      null,
      2
    ) + '\n'
  );

  await writeFile(
    join(projectDir, 'fsn.config.js'),
    await renderTemplate('fsn.config.template.js', { $$framework: framework })
  );

  await writeFile(
    join(projectDir, '.gitignore'),
    `node_modules\ndist\n.DS_Store\n*.log\n`
  );
}

// ---------------------------------------------------------------------------
// fsn build
// ---------------------------------------------------------------------------

async function build() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const nativeDir = join(cwd, 'native');
  if (!await exists(nativeDir)) {
    throw new Error(`native/ directory not found in ${cwd}`);
  }

  const workdir = await mkdtemp(join(tmpdir(), 'fsn-build-'));
  log(`workdir: ${workdir}`);

  try {
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
    // The consumer's pnpm-workspace.yaml may gate build scripts via
    // onlyBuiltDependencies. In the isolated build workdir every package
    // should be allowed to run its postinstall — drop that field.
    const workWsYaml = join(workdir, 'pnpm-workspace.yaml');
    if (await exists(workWsYaml)) {
      const stripped = (await readFile(workWsYaml, 'utf8'))
        .replace(/^onlyBuiltDependencies:[^\n]*(\n[ \t]+[^\n]+)*/gm, '')
        .trimEnd() + '\n';
      await writeFile(workWsYaml, stripped);
    }
    const workNative = join(workdir, 'native');

    // 2. Install + build the framework.
    // pnpm v10+ requires explicit build-script approval for new deps. Try the
    // install; if it exits non-zero (ERR_PNPM_IGNORED_BUILDS), approve all
    // pending scripts and retry once before giving up.
    try {
      await run('pnpm', ['install', '--prefer-offline'], { cwd: workNative });
    } catch {
      try { await run('pnpm', ['approve-builds', '--all'], { cwd: workdir }); } catch {}
      await run('pnpm', ['install', '--prefer-offline'], { cwd: workNative });
    }
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
  } finally {
    // Keep workdir on failure so it can be inspected; remove on success.
    // (Skipped: the throw path leaves workdir intact, the success path falls
    // through to here. We intentionally don't auto-delete to make debugging
    // easier — temp dirs get cleaned up by the OS eventually.)
  }
}

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

function sanitizeAppName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

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

async function renderTemplate(name, vars) {
  let src = await readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
  for (const [placeholder, value] of Object.entries(vars)) {
    src = src.replaceAll(placeholder, value);
  }
  return src;
}

main().catch((err) => {
  process.stderr.write('[fsn] error: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
