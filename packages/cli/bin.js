#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { pathToFileURL } = require('node:url');

const FRAMEWORKS = new Set(['sveltekit', 'nextjs']);

const USAGE = `fsn — Full-Stack Native

Commands:
  fsn <project-name> init <sveltekit|nextjs>   Scaffold a new FSN project.
  fsn build                                    Build the current project into a native app.
`;

function log(...args) {
  process.stderr.write('[fsn] ' + args.join(' ') + '\n');
}

function run(cmd, args, options = {}) {
  log('$', cmd, args.join(' '), options.cwd ? `(cwd=${options.cwd})` : '');
  const result = cp.spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '--help' || argv[0] === '-h' || argv.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  if (argv[0] === 'build' && argv.length === 1) {
    return await build();
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

// ---------------------------------------------------------------------------
// fsn <project-name> init <framework>
// ---------------------------------------------------------------------------

async function init(projectName, framework) {
  const projectDir = path.resolve(projectName);
  if (fs.existsSync(projectDir)) {
    const entries = fs.readdirSync(projectDir);
    if (entries.length > 0) {
      throw new Error(`${projectDir} already exists and is not empty.`);
    }
  } else {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  if (framework === 'sveltekit') {
    await scaffoldSveltekit(projectDir);
  } else if (framework === 'nextjs') {
    await scaffoldNextjs(projectDir);
  }

  writeWorkspaceFiles(projectDir, projectName, framework);

  log(`done. Next:`);
  log(`  cd ${projectName}`);
  log(`  pnpm install`);
  log(`  pnpm build`);
}

async function scaffoldSveltekit(projectDir) {
  // sv create scaffolds into ./<dir>; we run it with cwd=projectDir so the
  // skeleton lands in projectDir/native.
  run('pnpm', [
    'dlx',
    'sv@latest',
    'create',
    'native',
    '--template', 'minimal',
    '--types', 'ts',
    '--no-add-ons',
    '--no-install',
    '--no-dir-check',
    '--no-download-check',
  ], { cwd: projectDir });

  const nativeDir = path.join(projectDir, 'native');

  // Switch adapter-auto → adapter-static so `pnpm build` emits a self-contained
  // static site that the Electron main process can serve via protocol.handle.
  const sveltConfigPath = path.join(nativeDir, 'svelte.config.js');
  let sveltConfig = fs.readFileSync(sveltConfigPath, 'utf8');
  sveltConfig = sveltConfig.replace(
    /@sveltejs\/adapter-auto/g,
    '@sveltejs/adapter-static'
  );
  fs.writeFileSync(sveltConfigPath, sveltConfig);

  const pkgPath = path.join(nativeDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.devDependencies = pkg.devDependencies || {};
  delete pkg.devDependencies['@sveltejs/adapter-auto'];
  pkg.devDependencies['@sveltejs/adapter-static'] = '^3.0.8';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // adapter-static requires every route to be prerenderable. Setting
  // `prerender = true` in the root layout is the most ergonomic way to opt all
  // routes in without per-page edits.
  const routesDir = path.join(nativeDir, 'src', 'routes');
  fs.mkdirSync(routesDir, { recursive: true });
  fs.writeFileSync(
    path.join(routesDir, '+layout.ts'),
    `export const prerender = true;\n`
  );
}

async function scaffoldNextjs(projectDir) {
  // create-next-app doesn't accept a relative path with trailing components;
  // running it with cwd=projectDir lands the project in projectDir/native.
  run('pnpm', [
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

  const nativeDir = path.join(projectDir, 'native');

  // create-next-app drops its own pnpm-workspace.yaml inside the package to
  // suppress postinstall scripts. Our parent already controls those via
  // `onlyBuiltDependencies`, and a nested workspace yaml confuses pnpm.
  const nestedWs = path.join(nativeDir, 'pnpm-workspace.yaml');
  if (fs.existsSync(nestedWs)) fs.rmSync(nestedWs);

  // Set `output: 'export'` so `next build` produces a static `out/` directory
  // that the Electron main process can serve via protocol.handle. Also disable
  // the next/image optimizer because export mode does not support it.
  const cfgTs = path.join(nativeDir, 'next.config.ts');
  const cfgMjs = path.join(nativeDir, 'next.config.mjs');
  const cfgJs = path.join(nativeDir, 'next.config.js');
  const cfgPath = fs.existsSync(cfgTs) ? cfgTs : fs.existsSync(cfgMjs) ? cfgMjs : cfgJs;
  const useTs = cfgPath.endsWith('.ts');

  const cfg = useTs
    ? `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
`
    : `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
`;
  fs.writeFileSync(cfgPath, cfg);
}

function writeWorkspaceFiles(projectDir, projectName, framework) {
  fs.writeFileSync(
    path.join(projectDir, 'pnpm-workspace.yaml'),
    `packages:\n  - native\n\nonlyBuiltDependencies:\n  - electron\n`
  );

  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: path.basename(projectName),
        private: true,
        version: '0.0.0',
        scripts: {
          build: 'fsn build',
        },
        devDependencies: {
          fsn: '*',
        },
      },
      null,
      2
    ) + '\n'
  );

  fs.writeFileSync(
    path.join(projectDir, 'fsn.config.js'),
    `/** @type {import('fsn').Config} */
export default {
  type: '${framework}',
};
`
  );

  fs.writeFileSync(
    path.join(projectDir, '.gitignore'),
    `node_modules\ndist\n.DS_Store\n*.log\n`
  );
}

// ---------------------------------------------------------------------------
// fsn build
// ---------------------------------------------------------------------------

async function build() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const nativeDir = path.join(cwd, 'native');
  if (!fs.existsSync(nativeDir)) {
    throw new Error(`native/ directory not found in ${cwd}`);
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsn-build-'));
  log(`workdir: ${workdir}`);

  try {
    // 1. Copy native/ → workdir/native (skip node_modules and prior build output)
    const workNative = path.join(workdir, 'native');
    copyTree(nativeDir, workNative, [
      'node_modules',
      '.next',
      '.svelte-kit',
      'build',
      'out',
      'dist',
    ]);

    // 2. Install + build the framework
    run('pnpm', ['install', '--prefer-offline'], { cwd: workNative });
    run('pnpm', ['build'], { cwd: workNative });

    // 3. Locate framework build output
    const outputName = config.type === 'sveltekit' ? 'build' : 'out';
    const frameworkOut = path.join(workNative, outputName);
    if (!fs.existsSync(frameworkOut)) {
      throw new Error(
        `Expected framework build output at ${frameworkOut} but didn't find it.`
      );
    }

    // 4. Move output to workdir/web and discard the native source
    const webDir = path.join(workdir, 'web');
    fs.renameSync(frameworkOut, webDir);
    fs.rmSync(workNative, { recursive: true, force: true });

    // 5. Write the Electron main process
    fs.writeFileSync(
      path.join(workdir, 'application.js'),
      buildApplicationJs(path.basename(cwd))
    );

    // 6. Write a package.json for the Electron app and install Electron +
    //    @electron/packager. We use npm here (not pnpm) because the workdir
    //    is throwaway and npm doesn't gate Electron's post-install download.
    const appName = sanitizeAppName(path.basename(cwd));
    fs.writeFileSync(
      path.join(workdir, 'package.json'),
      JSON.stringify(
        {
          name: appName,
          version: '0.0.0',
          private: true,
          main: 'application.js',
        },
        null,
        2
      ) + '\n'
    );

    run('npm', ['install', '--no-audit', '--no-fund', '--save-dev',
      'electron@latest',
      '@electron/packager@latest',
    ], { cwd: workdir });

    // 7. Package the app
    const platform = process.platform === 'darwin' ? 'darwin'
      : process.platform === 'win32' ? 'win32' : 'linux';
    run('npx', ['--yes', '@electron/packager', '.', appName,
      '--out', 'dist',
      '--overwrite',
      '--platform', platform,
      '--arch', process.arch,
    ], { cwd: workdir });

    // 8. Copy result back to ./dist
    const projectDist = path.join(cwd, 'dist');
    if (fs.existsSync(projectDist)) {
      fs.rmSync(projectDist, { recursive: true, force: true });
    }
    fs.cpSync(path.join(workdir, 'dist'), projectDist, { recursive: true });

    log(`✓ Built native app at ${projectDist}`);
  } finally {
    // Keep workdir on failure so it can be inspected; remove on success.
    // (Skipped: the throw path leaves workdir intact, the success path falls
    // through to here. We intentionally don't auto-delete to make debugging
    // easier — temp dirs get cleaned up by the OS eventually.)
  }
}

async function loadConfig(cwd) {
  const configPath = path.join(cwd, 'fsn.config.js');
  if (!fs.existsSync(configPath)) {
    throw new Error(`fsn.config.js not found in ${cwd}`);
  }
  const mod = await import(pathToFileURL(configPath).href);
  const config = mod.default || mod;
  if (!config || !FRAMEWORKS.has(config.type)) {
    throw new Error(
      `fsn.config.js must default-export { type: 'sveltekit' | 'nextjs' }`
    );
  }
  return config;
}

function sanitizeAppName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function copyTree(src, dest, exclude = []) {
  const skip = new Set(exclude);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d, exclude);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function buildApplicationJs(projectName) {
  return `'use strict';

// Electron main process. Serves the static framework build (web/) over a
// protocol handler bound to a virtual host, then loads the homepage in a
// BrowserWindow. This is the MVP path — protocol.handle for static files only.
// The full IpcView bridge (mounting a live Node handler) is a future upgrade.

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol, net } = require('electron');

const WEB_DIR = path.join(__dirname, 'web');
const APP_HOST = 'app.localhost';
const APP_ORIGIN = 'http://' + APP_HOST;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.map':  'application/json; charset=utf-8',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Resolve a request path against WEB_DIR, guarding against traversal.
function resolveWithin(reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const resolved = path.normalize(path.join(WEB_DIR, decoded));
  const root = WEB_DIR + path.sep;
  if (resolved !== WEB_DIR && !resolved.startsWith(root)) return null;
  return resolved;
}

function pickFile(target) {
  // Try the exact target, then target + .html, then target/index.html,
  // then the SPA fallback at WEB_DIR/index.html. Static-site generators
  // produce one of these shapes depending on trailingSlash / cleanURLs.
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return target;
    if (stat.isDirectory()) {
      const idx = path.join(target, 'index.html');
      if (fs.existsSync(idx)) return idx;
    }
  } catch (_) {}
  const htmlVariant = target + '.html';
  if (fs.existsSync(htmlVariant)) return htmlVariant;
  const fallback = path.join(WEB_DIR, 'index.html');
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

app.whenReady().then(() => {
  protocol.handle('http', async (request) => {
    const url = new URL(request.url);
    if (url.host.toLowerCase() !== APP_HOST) {
      try {
        return await net.fetch(request, { bypassCustomProtocolHandlers: true });
      } catch (err) {
        return new Response('Upstream fetch failed: ' + err.message, {
          status: 502,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    }
    const target = resolveWithin(url.pathname);
    if (!target) {
      return new Response('Bad request', { status: 400 });
    }
    const file = pickFile(target);
    if (!file) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const data = await fs.promises.readFile(file);
    return new Response(data, {
      status: 200,
      headers: { 'content-type': mimeFor(file) },
    });
  });

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: ${JSON.stringify(projectName)},
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(APP_ORIGIN + '/');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;
}

main().catch((err) => {
  process.stderr.write('[fsn] error: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
