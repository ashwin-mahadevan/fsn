import { readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { log, exists, run, readAsset } from './utils.js';

export async function init(projectName: string, framework: string): Promise<void> {
  const projectDir = resolve(projectName);
  if (await exists(projectDir)) {
    const entries = await readdir(projectDir);
    if (entries.length > 0) {
      throw new Error(`${projectDir} already exists and is not empty.`);
    }
  } else {
    await mkdir(projectDir, { recursive: true });
  }

  if (framework === 'sveltekit') {
    await scaffoldSveltekit(projectDir);
  } else if (framework === 'nextjs') {
    await scaffoldNextjs(projectDir);
  }

  await writeWorkspaceFiles(projectDir, projectName, framework);

  log(`done. Next:`);
  log(`  cd ${projectName}`);
  log(`  pnpm install`);
  log(`  pnpm build`);
}

async function scaffoldSveltekit(projectDir: string): Promise<void> {
  // sv create scaffolds into ./<dir>; we run it with cwd=projectDir so the
  // skeleton lands in projectDir/native.
  await run('pnpm', [
    'dlx',
    'sv@latest',
    'create',
    'native',
    '--template', 'demo',
    '--types', 'ts',
    '--no-add-ons',
    '--no-install',
    '--no-dir-check',
    '--no-download-check',
  ], { cwd: projectDir });

  const nativeDir = join(projectDir, 'native');

  // Swap the default adapter-auto for adapter-node so `pnpm build` emits a
  // runnable Node server that the Electron main process can host — this is
  // the whole point of FSN: ship fullstack frameworks, not static exports.
  // `sv add` rewrites svelte.config.js and the package.json devDep for us.
  await run('pnpm', [
    'dlx',
    'sv@latest',
    'add',
    'sveltekit-adapter=adapter:node',
    '-C', nativeDir,
    '--no-install',
    '--no-git-check',
    '--no-download-check',
  ]);
}

async function scaffoldNextjs(projectDir: string): Promise<void> {
  // create-next-app doesn't accept a relative path with trailing components;
  // running it with cwd=projectDir lands the project in projectDir/native.
  await run('pnpm', [
    'dlx',
    'create-next-app@latest',
    'native',
    '--yes',
    '--ts',
    '--eslint',
    '--app',
    '--src-dir',
    '--no-tailwind',
    '--import-alias', '@/*',
    '--use-pnpm',
    '--skip-install',
    '--disable-git',
  ], { cwd: projectDir });

  const nativeDir = join(projectDir, 'native');

  // create-next-app drops its own pnpm-workspace.yaml inside the package to
  // suppress postinstall scripts. Our parent already controls those via
  // `onlyBuiltDependencies`, and a nested workspace yaml confuses pnpm.
  const nestedWs = join(nativeDir, 'pnpm-workspace.yaml');
  if (await exists(nestedWs)) await rm(nestedWs);
}

async function writeWorkspaceFiles(projectDir: string, projectName: string, framework: string): Promise<void> {
  await writeFile(
    join(projectDir, 'pnpm-workspace.yaml'),
    `packages:\n  - native\n\nonlyBuiltDependencies:\n  - electron\n` +
      // Next.js pulls in sharp, whose build script pnpm 10+ refuses to run
      // unless it's explicitly approved.
      (framework === 'nextjs' ? `\nallowBuilds:\n  sharp: true\n` : '')
  );

  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: basename(projectName),
        private: true,
        version: '0.0.0',
        scripts: {
          build: 'fsn build',
        },
        devDependencies: {
          '@fsn.dev/cli': '*',
        },
      },
      null,
      2
    ) + '\n'
  );

  await writeFile(
    join(projectDir, 'fsn.config.js'),
    `/** @type {import('@fsn.dev/cli').Config} */\nexport default {\n  hosts: {\n    native: './native/fsn.host.js',\n  },\n};\n`
  );

  await writeFile(
    join(projectDir, 'native', 'fsn.host.js'),
    await readAsset(`fsn.host.${framework}.js`)
  );

  await writeFile(
    join(projectDir, '.gitignore'),
    `node_modules\ndist\n.DS_Store\n*.log\n`
  );
}
