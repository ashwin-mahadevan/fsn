#!/usr/bin/env node

import build from './build.js';
import buildHost from './build-host.js';
import init from './init.js';

const FRAMEWORKS = new Set(['sveltekit', 'nextjs']);

const USAGE = `fsn — Full-Stack Native

Commands:
  fsn <project-name> init <sveltekit|nextjs>   Scaffold a new FSN project.
  fsn build                                    Build the current project into a native app.
  fsn host <name>                              Build a single host in a multi-host project.
`;

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '--help' || argv[0] === '-h' || argv.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  if (argv[0] === 'build' && argv.length === 1) {
    return await build();
  }

  if (argv[0] === 'host' && argv.length === 2) {
    return await buildHost(argv[1]);
  }

  if (argv.length === 3 && argv[1] === 'init') {
    const [projectName, , framework] = argv;
    if (!FRAMEWORKS.has(framework)) {
      throw new Error(`Unknown framework "${framework}". Expected one of: ${[...FRAMEWORKS].join(', ')}`);
    }
    return await init(projectName, framework);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write('[fsn] error: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
