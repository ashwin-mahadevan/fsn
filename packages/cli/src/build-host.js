import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log, exists, run } from './utils.js';

/**
 * Build a single named host in the current FSN project.
 * Reads fsn.config.js to locate the host directory, installs dependencies
 * if needed, then runs `pnpm build`.
 *
 * @param {string} name  Key in config.hosts, e.g. "sveltekit"
 */
export default async function buildHost(name) {
  const cwd = process.cwd();
  const configPath = join(cwd, 'fsn.config.js');
  if (!await exists(configPath)) {
    throw new Error(`fsn.config.js not found in ${cwd}`);
  }

  const mod = await import(pathToFileURL(configPath).href);
  const config = mod.default || mod;
  if (!config.hosts || typeof config.hosts !== 'object') {
    throw new Error(`fsn.config.js must export { hosts: Record<string, string> } for multi-host projects`);
  }

  const hostRelPath = config.hosts[name];
  if (!hostRelPath) {
    throw new Error(`Host "${name}" not found in fsn.config.js. Available: ${Object.keys(config.hosts).join(', ')}`);
  }

  const hostDir = resolve(cwd, dirname(hostRelPath));
  log(`building host "${name}" in ${hostDir}`);

  if (!await exists(join(hostDir, 'node_modules'))) {
    await run('pnpm', ['install'], { cwd: hostDir });
  }

  await run('pnpm', ['build'], { cwd: hostDir });
  log(`✓ host "${name}" built`);
}
