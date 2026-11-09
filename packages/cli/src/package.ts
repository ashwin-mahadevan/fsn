import { writeFile, readFile, rm, cp } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { log, exists, run } from './utils.js';

function sanitizeAppName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

/**
 * The Electron and @electron/packager versions to build with. They're pinned
 * in this package's devDependencies (exact versions) so builds are
 * reproducible and bumped like any other dependency.
 */
async function pinnedVersions(): Promise<Record<'electron' | '@electron/packager', string>> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const result = {} as Record<'electron' | '@electron/packager', string>;
  for (const name of ['electron', '@electron/packager'] as const) {
    const version = pkg.devDependencies?.[name];
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error(`@fsn.dev/cli is missing a pinned version for ${name}.`);
    }
    result[name] = version;
  }
  return result;
}

/**
 * Turn a staged workdir (Electron main file + app/) into a packaged native app
 * and copy it to <cwd>/dist.
 *
 * Writes the Electron app's package.json, installs Electron and
 * @electron/packager, runs the packager for the current platform/arch, then
 * replaces <cwd>/dist with the result. We use npm here (not pnpm) because the
 * workdir is throwaway and npm doesn't gate Electron's post-install download.
 *
 * @param options.workdir  Directory containing `main` and `app/`.
 * @param options.cwd      The user's project directory.
 * @param options.main     Filename of the Electron main process in workdir.
 */
export async function packageApp({ workdir, cwd, main }: {
  workdir: string;
  cwd: string;
  main: string;
}): Promise<void> {
  const versions = await pinnedVersions();
  const appName = sanitizeAppName(basename(cwd));
  await writeFile(
    join(workdir, 'package.json'),
    JSON.stringify(
      { name: appName, version: '0.0.0', private: true, type: 'module', main },
      null,
      2
    ) + '\n'
  );

  await run('npm', ['install', '--no-audit', '--no-fund', '--save-dev',
    `electron@${versions.electron}`,
    `@electron/packager@${versions['@electron/packager']}`,
  ], { cwd: workdir });

  const platform = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'win32' : 'linux';
  await run('npx', ['--no-install', '@electron/packager', '.', appName,
    '--out', 'dist',
    '--overwrite',
    '--platform', platform,
    '--arch', process.arch,
  ], { cwd: workdir });

  const projectDist = join(cwd, 'dist');
  if (await exists(projectDist)) {
    await rm(projectDist, { recursive: true, force: true });
  }
  // verbatimSymlinks: keep the .app's relative framework symlinks intact.
  // Without it, fs.cp rewrites them to absolute paths into the temp workdir,
  // which breaks the packaged app (e.g. Electron can't find icudtl.dat).
  await cp(join(workdir, 'dist'), projectDist, { recursive: true, verbatimSymlinks: true });

  log(`✓ Built native app at ${projectDist}`);
}
