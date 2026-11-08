import { writeFile, rm, cp } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { log, exists, run } from './utils.js';

/** @param {string} name */
function sanitizeAppName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
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
 * @param {object} options
 * @param {string} options.workdir  Directory containing `main` and `app/`.
 * @param {string} options.cwd      The user's project directory.
 * @param {string} options.main     Filename of the Electron main process in workdir.
 * @param {boolean} [options.esm]   Whether `main` is an ES module.
 */
export async function packageApp({ workdir, cwd, main, esm = false }) {
  const appName = sanitizeAppName(basename(cwd));
  await writeFile(
    join(workdir, 'package.json'),
    JSON.stringify(
      { name: appName, version: '0.0.0', private: true, ...(esm && { type: 'module' }), main },
      null,
      2
    ) + '\n'
  );

  await run('npm', ['install', '--no-audit', '--no-fund', '--save-dev',
    'electron@latest',
    '@electron/packager@latest',
  ], { cwd: workdir });

  const platform = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'win32' : 'linux';
  await run('npx', ['--yes', '@electron/packager', '.', appName,
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
