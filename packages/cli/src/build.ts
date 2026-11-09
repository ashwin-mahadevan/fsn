import {
  readdir,
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  lstat,
  rm,
  rename,
  cp,
  symlink,
  readlink,
  copyFile,
} from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { log, exists, run, renderTemplate } from './utils.js';
import { loadConfig } from './config.js';
import { packageApp } from './package.js';

const ESM_PACKAGE_JSON = JSON.stringify({ type: 'module' }, null, 2) + '\n';

export default async function build(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  if ('hosts' in config) {
    return buildMultiHost(config, cwd);
  }

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
    await writeFile(join(appDir, 'package.json'), ESM_PACKAGE_JSON);
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
    await stageNextjs(workNative, appDir, { filter: 'native', cwd: workdir });
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

  // 5. Package the app and copy it back to ./dist
  await packageApp({ workdir, cwd, main: 'application.js' });
}

// ---------------------------------------------------------------------------
// Multi-host build
// ---------------------------------------------------------------------------

async function buildMultiHost(config: { hosts: Record<string, string> }, cwd: string): Promise<void> {
  const workdir = await mkdtemp(join(tmpdir(), 'fsn-build-'));
  log(`workdir: ${workdir}`);

  const appDir = join(workdir, 'app');
  await mkdir(appDir, { recursive: true });

  for (const [name, hostRelPath] of Object.entries(config.hosts)) {
    const hostJsPath = resolve(cwd, hostRelPath);
    const hostDir = dirname(hostJsPath);
    const appHostDir = join(appDir, name);
    await mkdir(appHostDir, { recursive: true });

    const isNextjs    = await exists(join(hostDir, '.next'));
    const isSvelteKit = await exists(join(hostDir, 'build', 'handler.js'));

    if (isSvelteKit) {
      // Copy adapter-node output. add package.json so Node treats it as ESM
      // without the re-parse perf warning.
      await cp(join(hostDir, 'build'), join(appHostDir, 'build'), { recursive: true });
      await writeFile(join(appHostDir, 'build', 'package.json'), ESM_PACKAGE_JSON);
    } else if (isNextjs) {
      const { name: pkgName } = JSON.parse(
        await readFile(join(hostDir, 'package.json'), 'utf8')
      );
      await stageNextjs(hostDir, appHostDir, { filter: pkgName, cwd });
    } else {
      throw new Error(
        `Cannot detect framework for host "${name}" at ${hostDir}. ` +
        `Run "fsn host ${name}" first, or ensure the framework has been built.`
      );
    }

    // Copy the user's fsn.host.js into the staged directory.
    await copyFile(hostJsPath, join(appHostDir, 'fsn.host.js'));
  }

  // Stage fsn.config.js so the main process can read hosts at runtime.
  await copyFile(join(cwd, 'fsn.config.js'), join(appDir, 'fsn.config.js'));

  // Write the multi-host Electron main (ESM, InProcessSocket-based).
  await writeFile(
    join(workdir, 'main.js'),
    await readFile(new URL('../assets/application.multi-host.template.js', import.meta.url), 'utf8')
  );

  await packageApp({ workdir, cwd, main: 'main.js', esm: true });
}

/**
 * Stage a built Next.js app into `dest` for packaging.
 *
 * pnpm's isolated install leaves node_modules full of symlinks into
 * .pnpm/ — that breaks require() once the tree is asar-bundled. `pnpm deploy`
 * rewrites the tree with all prod deps fully inlined and devDeps stripped,
 * using --node-linker=hoisted so node_modules is flat (no .pnpm subdir).
 * It only copies the package's published files, so the build output and
 * runtime-relevant config/assets are layered back on afterwards.
 *
 * @param srcDir  Directory containing the built Next.js package.
 * @param dest    Where to stage it.
 * @param options
 *   `filter` is the package name for pnpm --filter; `cwd` is a directory
 *   inside the pnpm workspace that contains it.
 */
async function stageNextjs(
  srcDir: string,
  dest: string,
  { filter, cwd }: { filter: string; cwd: string }
): Promise<void> {
  await run('pnpm', ['--filter', filter, 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', dest], { cwd });
  // Hoisted deploy leaves symlinks to sibling workspace packages in
  // node_modules; once staged elsewhere they dangle and break packaging.
  const nodeModules = join(dest, 'node_modules');
  for (const entry of await readdir(nodeModules)) {
    const p = join(nodeModules, entry);
    if ((await lstat(p)).isSymbolicLink() && !await exists(p)) await rm(p);
  }
  await cp(join(srcDir, '.next'), join(dest, '.next'), { recursive: true });
  for (const dir of ['public', 'src']) {
    const src = join(srcDir, dir);
    if (await exists(src)) await cp(src, join(dest, dir), { recursive: true });
  }
  for (const cfg of ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next-env.d.ts', 'tsconfig.json']) {
    const src = join(srcDir, cfg);
    if (await exists(src)) await cp(src, join(dest, cfg));
  }
}

async function copyTree(src: string, dest: string, exclude: string[] = []): Promise<void> {
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
