#!/usr/bin/env node

import { build } from './build.js';
import { init } from './init.js';

const FRAMEWORKS = new Set(['sveltekit', 'nextjs']);

const USAGE = `fsn — Full-Stack Native

Commands:
  fsn init [--project <dir>] [--framework <sveltekit|nextjs>]
                                               Scaffold a new FSN project.
                                               --project defaults to "." (must be empty),
                                               --framework defaults to nextjs.
  fsn build                                    Build the current project into a native app.
`;

try {
  if (process.argv[2] === '--help' || process.argv[2] === '-h' || process.argv.length === 2) {
    process.stdout.write(USAGE);
  } else if (process.argv[2] === 'build' && process.argv.length === 3) {
    await build();
  } else if (process.argv[2] === 'init') {
    let project = '.';
    let framework = 'nextjs';
    for (let i = 3; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      if (flag !== '--project' && flag !== '--framework') {
        throw new Error(`Unknown argument "${flag}".\n\n${USAGE}`);
      }
      const value = process.argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${flag}.`);
      }
      if (flag === '--project') project = value;
      else framework = value;
    }
    if (!FRAMEWORKS.has(framework)) {
      throw new Error(`Unknown framework "${framework}". Expected one of: ${[...FRAMEWORKS].join(', ')}`);
    }
    await init(project, framework);
  } else {
    process.stderr.write(USAGE);
    process.exit(1);
  }
} catch (err) {
  process.stderr.write('[fsn] error: ' + (err instanceof Error && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
}
