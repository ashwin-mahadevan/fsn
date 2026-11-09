import { join, dirname, resolve } from 'node:path';
import { log, exists, run } from './utils.js';
import { loadConfig } from './config.js';

/**
 * Build a single named host in the current FSN project.
 * Reads fsn.config.js to locate the host directory, installs dependencies
 * if needed, then runs `pnpm build`.
 *
 * @param name  Key in config.hosts, e.g. "sveltekit"
 */
export async function buildHost(name: string): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  if (!('hosts' in config)) {
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
