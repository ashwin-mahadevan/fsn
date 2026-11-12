import { readdir, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { log, exists, run } from './utils.js';

/**
 * The version range FSN packages are installed at in new projects. The CLI and
 * its adapters are released in lockstep, so this is the CLI's own version.
 */
async function fsnVersionRange(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  return `^${pkg.version}`;
}

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

  await writeWorkspaceFiles(projectDir);

  log(`done. Next:`);
  if (projectDir !== process.cwd()) log(`  cd ${projectName}`);
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

  // Swap the default adapter-auto for FSN's adapter, which builds the app
  // into a host the Electron main process calls in-process — this is the
  // whole point of FSN: ship fullstack frameworks, not static exports.
  const nativeDir = join(projectDir, 'native');

  // Newer sv templates put the kit config in vite.config.ts; older ones use
  // svelte.config.js. Patch whichever imports adapter-auto.
  let patched = false;
  for (const file of ['svelte.config.js', 'vite.config.ts', 'vite.config.js']) {
    const configPath = join(nativeDir, file);
    if (!await exists(configPath)) continue;
    const source = await readFile(configPath, 'utf8');
    if (!source.includes(`'@sveltejs/adapter-auto'`)) continue;
    await writeFile(configPath, source.replace(`'@sveltejs/adapter-auto'`, `'@fsn.dev/adapter-sveltekit'`));
    patched = true;
  }
  if (!patched) {
    throw new Error(`Couldn't find the @sveltejs/adapter-auto import in ${nativeDir} to replace.`);
  }

  const pkgPath = join(nativeDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  delete pkg.devDependencies['@sveltejs/adapter-auto'];
  pkg.devDependencies['@fsn.dev/adapter-sveltekit'] = await fsnVersionRange();
  await writeFile(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');

  await removeNestedWorkspace(nativeDir);
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

  await removeNestedWorkspace(nativeDir);
}

/**
 * create-next-app and sv both drop a pnpm-workspace.yaml inside the package
 * to configure build scripts. Our parent workspace already controls those via
 * `onlyBuiltDependencies`, and a nested workspace yaml confuses pnpm.
 */
async function removeNestedWorkspace(nativeDir: string): Promise<void> {
  const nestedWs = join(nativeDir, 'pnpm-workspace.yaml');
  if (await exists(nestedWs)) await rm(nestedWs);
}

async function writeWorkspaceFiles(projectDir: string): Promise<void> {
  await writeFile(
    join(projectDir, 'pnpm-workspace.yaml'),
    // Both templates pull in sharp (Next.js directly, SvelteKit via
    // enhanced-img), and the CLI pulls in esbuild. pnpm 10+ refuses to run
    // their build scripts unless they're explicitly approved.
    `packages:\n  - native\n\nonlyBuiltDependencies:\n  - electron\n\nallowBuilds:\n  sharp: true\n  esbuild: true\n`
  );

  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: basename(projectDir),
        private: true,
        version: '0.0.0',
        scripts: {
          build: 'fsn build',
        },
        devDependencies: {
          '@fsn.dev/cli': await fsnVersionRange(),
        },
      },
      null,
      2
    ) + '\n'
  );

  await writeFile(
    join(projectDir, 'fsn.config.js'),
    `/** @type {import('@fsn.dev/cli').Config} */\nexport default {\n  hosts: {\n    native: './native',\n  },\n};\n`
  );

  await writeFile(
    join(projectDir, '.gitignore'),
    `node_modules\ndist\n.DS_Store\n*.log\n`
  );
}
