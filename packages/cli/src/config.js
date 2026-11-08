import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists } from './utils.js';

export const FRAMEWORKS = new Set(['sveltekit', 'nextjs']);

/**
 * Load and validate fsn.config.js from a project directory.
 *
 * @param {string} cwd
 * @returns {Promise<import('./index.d.ts').Config>}
 */
export async function loadConfig(cwd) {
  const configPath = join(cwd, 'fsn.config.js');
  if (!await exists(configPath)) {
    throw new Error(`fsn.config.js not found in ${cwd}`);
  }
  const mod = await import(pathToFileURL(configPath).href);
  const config = mod.default || mod;
  if (!config) {
    throw new Error(`fsn.config.js must default-export a Config object`);
  }
  if ('hosts' in config) {
    if (typeof config.hosts !== 'object' || Object.keys(config.hosts).length === 0) {
      throw new Error(`fsn.config.js: hosts must be a non-empty object mapping names to fsn.host.js paths`);
    }
    return config;
  }
  if (!FRAMEWORKS.has(config.type)) {
    throw new Error(
      `fsn.config.js must default-export { type: 'sveltekit' | 'nextjs' } or { hosts: Record<string, string> }`
    );
  }
  return config;
}
