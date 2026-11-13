import { mkdir, mkdtemp, writeFile, readFile, readdir, lstat, rm, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { log, exists, run, readAsset } from './utils.js';
import { loadConfig } from './config.js';
import { buildHost } from './build-host.js';
import { bundleHooks } from './hooks.js';
import { packageApp } from './package.js';

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

  // Host name → the module the main process loads for it, relative to the
  // main: one that default-exports { fetch(request) => Response }.
  const entries: Record<string, string> = {};

  for (const [name, hostRelDir] of Object.entries(config.hosts)) {
    const hostDir = resolve(cwd, hostRelDir);
    const appHostDir = join(appDir, name);
    await mkdir(appHostDir, { recursive: true });

    const hostPkg = JSON.parse(await readFile(join(hostDir, 'package.json'), 'utf8'));
    const hostDeps = { ...hostPkg.dependencies, ...hostPkg.devDependencies };
    const isSvelteKit = '@sveltejs/kit' in hostDeps;
    const isNextjs    = 'next' in hostDeps;

    if (!isSvelteKit && !isNextjs) {
      throw new Error(
        `Cannot detect framework for host "${name}" at ${hostDir}: ` +
        `expected @sveltejs/kit or next in its package.json.`
      );
    }

    // Production dependencies (only `dependencies`, flattened).
    await deployProd(appHostDir, { filter: hostPkg.name, cwd });

    let entry: string;
    if (isSvelteKit) {
      // @fsn.dev/adapter-sveltekit's build/: the server bundled with its
      // devDependencies, plus client assets and prerendered pages. Its
      // index.js is the module the main process loads.
      const buildDir = join(hostDir, 'build');
      if (!await exists(join(buildDir, 'index.js'))) {
        throw new Error(
          `Host "${name}" has no build/index.js. Is @fsn.dev/adapter-sveltekit ` +
          `its SvelteKit adapter?`
        );
      }
      await cp(buildDir, join(appHostDir, 'build'), { recursive: true });
      entry = 'build/index.js';
    } else {
      entry = await layerNextjsBuild(hostDir, appHostDir);
    }
    entries[name] = `./app/${name}/${entry}`;
  }

  // Stage the project's hooks, if it has any, for the main process to load.
  await bundleHooks(cwd, join(appDir, 'fsn.mjs'));

  // Write the Electron main, which routes window requests to each host. It
  // imports each host's module from where that was just staged.
  const loaders = Object.entries(entries).map(
    ([name, entry]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(entry)}),\n`
  );
  const main = (await readAsset('application.template.js'))
    .replace('__FSN_HOSTS__', () => `{\n${loaders.join('')}}`);
  await writeFile(join(workdir, 'main.js'), main);

  await packageApp({
    workdir, cwd, main: 'main.js',
    icon: config.icon && resolve(cwd, config.icon),
  });
}

/**
 * Install a host package's production dependencies into `dest`.
 *
 * pnpm's isolated install leaves node_modules full of symlinks into .pnpm/ —
 * those break require() once the tree is copied into the app. `pnpm deploy` rewrites
 * the tree with all prod deps fully inlined and devDeps stripped, using
 * --node-linker=hoisted so node_modules is flat (no .pnpm subdir). It also
 * copies the package's published files; build output is layered on after.
 *
 * @param options
 *   `filter` is the package name for pnpm --filter; `cwd` is a directory
 *   inside the pnpm workspace that contains it.
 */
async function deployProd(
  dest: string,
  { filter, cwd }: { filter: string; cwd: string }
): Promise<void> {
  // Non-legacy deploy needs a shared workspace lockfile (fsn init projects
  // have one). Without one, fall back to --legacy — which newer pnpm (12)
  // ignores when a lockfile exists, silently installing nothing.
  const legacy = await exists(join(cwd, 'pnpm-lock.yaml')) ? [] : ['--legacy'];
  await run('pnpm', ['--filter', filter, 'deploy', '--prod', ...legacy, '--config.node-linker=hoisted', dest], { cwd });
  // Hoisted deploy leaves symlinks to sibling workspace packages in
  // node_modules; once staged elsewhere they dangle and break packaging.
  const nodeModules = join(dest, 'node_modules');
  if (!await exists(nodeModules)) return;
  for (const entry of await readdir(nodeModules)) {
    const p = join(nodeModules, entry);
    if ((await lstat(p)).isSymbolicLink() && !await exists(p)) await rm(p);
  }
}

/**
 * Copy a built Next.js app's build output into `dest`. The host boots from
 * the config serialized in .next/, so no source or next.config.* is needed.
 *
 * @returns The module the main process loads for the host, relative to `dest`.
 */
async function layerNextjsBuild(srcDir: string, dest: string): Promise<string> {
  await cp(join(srcDir, '.next'), join(dest, '.next'), { recursive: true });
  if (await exists(join(srcDir, 'public'))) {
    await cp(join(srcDir, 'public'), join(dest, 'public'), { recursive: true });
  }
  await writeFile(join(dest, 'fsn.cache-handler.cjs'), await readAsset('fsn.cache-handler.nextjs.cjs'));

  // Next.js's build has no module the main process could load, so FSN stages
  // its own. It goes in the host's directory, where its import of `next`
  // finds the host's node_modules. .mjs, since the host's package.json may not
  // declare "type": "module".
  await writeFile(join(dest, 'fsn.host.mjs'), await readAsset('fsn.host.nextjs.js'));
  return 'fsn.host.mjs';
}
