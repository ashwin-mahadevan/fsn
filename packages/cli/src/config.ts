import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists } from './utils.js';
import type { Config } from './index.js';

/** Load and validate fsn.config.js from a project directory. */
export async function loadConfig(cwd: string): Promise<Config> {
  const configPath = join(cwd, 'fsn.config.js');
  if (!await exists(configPath)) {
    throw new Error(`fsn.config.js not found in ${cwd}`);
  }
  const mod = await import(pathToFileURL(configPath).href);
  const config = mod.default || mod;
  if (!config) {
    throw new Error(`fsn.config.js must default-export a Config object`);
  }
  if (typeof config.hosts !== 'object' || config.hosts === null || Object.keys(config.hosts).length === 0) {
    throw new Error(`fsn.config.js: hosts must be a non-empty object mapping names to package directories`);
  }
  for (const [name, hostPath] of Object.entries(config.hosts)) {
    if (typeof hostPath !== 'string' || !await exists(join(resolve(cwd, hostPath), 'package.json'))) {
      throw new Error(
        `fsn.config.js: hosts.${name} must be the path to a package directory ` +
        `(e.g. './native'), but ${JSON.stringify(hostPath)} has no package.json.`
      );
    }
  }
  return config;
}
