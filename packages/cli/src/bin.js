#!/usr/bin/env node

import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import build from './build.js';
import init from './init.js';

const program = new Command();

program
  .name('fsn')
  .description('Full-Stack Native — ship full-stack web apps as native desktop apps')
  .version('0.0.0');

program
  .command('init [project-name]')
  .description('Scaffold a new FSN project')
  .option('--sveltekit', 'use SvelteKit')
  .option('--nextjs', 'use Next.js')
  .action(async (projectName, opts) => {
    p.intro(pc.bgCyan(pc.black(' fsn init ')));

    const answers = await p.group(
      {
        name: () => {
          if (projectName) return Promise.resolve(projectName);
          return p.text({
            message: 'Project name',
            placeholder: 'my-app',
            validate: (v) => (v.trim() ? undefined : 'Project name is required'),
          });
        },
        framework: () => {
          if (opts.sveltekit) return Promise.resolve('sveltekit');
          if (opts.nextjs) return Promise.resolve('nextjs');
          return p.select({
            message: 'Framework',
            options: [
              { value: 'sveltekit', label: 'SvelteKit', hint: 'Svelte + adapter-node' },
              { value: 'nextjs', label: 'Next.js', hint: 'React + App Router' },
            ],
          });
        },
      },
      {
        onCancel: () => {
          p.cancel('Cancelled.');
          process.exit(1);
        },
      }
    );

    await init(answers.name, answers.framework);

    p.note(
      `cd ${answers.name}\npnpm install\npnpm build`,
      "What's next?"
    );
    p.outro(pc.green('Done!'));
  });

program
  .command('build')
  .description('Build the current project into a native app')
  .action(async () => {
    p.intro(pc.bgCyan(pc.black(' fsn build ')));
    await build();
    p.outro(pc.green('Done!'));
  });

program.parseAsync(process.argv).catch((err) => {
  p.log.error(err.message || String(err));
  process.exit(1);
});
