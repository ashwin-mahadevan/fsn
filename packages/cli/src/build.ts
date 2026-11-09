import {
  readdir,
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  lstat,
  rm,
  cp,
  copyFile,
} from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { log, exists, run, readAsset } from './utils.js';
import { loadConfig } from './config.js';
import { buildHost } from './build-host.js';
import { packageApp } from './package.js';

const ESM_PACKAGE_JSON = JSON.stringify({ type: 'module' }, null, 2) + '\n';

export async function build(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  // Make sure every host has been built before staging them.
  for (const name of Object.keys(config.hosts)) {
    await buildHost(name);
  }

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

  // Write the Electron main (ESM, InProcessSocket-based).
  await writeFile(join(workdir, 'main.js'), await readAsset('application.template.js'));

  await packageApp({ workdir, cwd, main: 'main.js' });
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
