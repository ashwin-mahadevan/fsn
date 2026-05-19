#!/usr/bin/env node

import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, renameSync, cpSync, symlinkSync, readlinkSync, copyFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
  const result = spawnSync(cmd, args, {
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
  const projectDir = resolve(projectName);
  if (existsSync(projectDir)) {
    const entries = readdirSync(projectDir);
    if (entries.length > 0) {
      throw new Error(`${projectDir} already exists and is not empty.`);
    }
  } else {
    mkdirSync(projectDir, { recursive: true });
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
  run('pnpm', [
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

  const nativeDir = join(projectDir, 'native');

  // create-next-app drops its own pnpm-workspace.yaml inside the package to
  // suppress postinstall scripts. Our parent already controls those via
  // `onlyBuiltDependencies`, and a nested workspace yaml confuses pnpm.
  const nestedWs = join(nativeDir, 'pnpm-workspace.yaml');
  if (existsSync(nestedWs)) rmSync(nestedWs);
}

function writeWorkspaceFiles(projectDir, projectName, framework) {
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    `packages:\n  - native\n\nonlyBuiltDependencies:\n  - electron\n`
  );

  writeFileSync(
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

  writeFileSync(
    join(projectDir, 'fsn.config.js'),
    `/** @type {import('@fsn.dev/cli').Config} */
export default {
  type: '${framework}',
};
`
  );

  writeFileSync(
    join(projectDir, '.gitignore'),
    `node_modules\ndist\n.DS_Store\n*.log\n`
  );
}

// ---------------------------------------------------------------------------
// fsn build
// ---------------------------------------------------------------------------

async function build() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const nativeDir = join(cwd, 'native');
  if (!existsSync(nativeDir)) {
    throw new Error(`native/ directory not found in ${cwd}`);
  }

  const workdir = mkdtempSync(join(tmpdir(), 'fsn-build-'));
  log(`workdir: ${workdir}`);

  try {
    // 1. Copy the whole project → workdir (skip node_modules, prior build
    //    output, and SCM noise). Bringing the project root along means pnpm
    //    picks up the consumer's pnpm-workspace.yaml — including its
    //    `allowBuilds` approvals — during the install in step 2.
    copyTree(cwd, workdir, [
      'node_modules',
      '.next',
      '.svelte-kit',
      'build',
      'out',
      'dist',
      '.git',
    ]);
    const workNative = join(workdir, 'native');

    // 2. Install + build the framework.
    run('pnpm', ['install', '--prefer-offline'], { cwd: workNative });
    run('pnpm', ['build'], { cwd: workNative });

    // 3. Stage the framework's runtime artifacts so the Electron main can
    //    import its handler at startup. Each framework gets the layout its
    //    handler expects:
    //      - sveltekit (adapter-node): workdir/build/ holds handler.js plus
    //        the bundled server + client assets. node_modules isn't needed
    //        because adapter-node inlines its server deps.
    //      - nextjs (custom server): we keep workdir/native/ as-is. The
    //        Electron main calls next({ dir: './native' }), and next reads
    //        .next/, public/, and node_modules/next from inside native/.
    if (config.type === 'sveltekit') {
      const adapterOut = join(workNative, 'build');
      if (!existsSync(adapterOut)) {
        throw new Error(`Expected adapter-node output at ${adapterOut} but didn't find it.`);
      }
      renameSync(adapterOut, join(workdir, 'build'));
      // adapter-node's handler.js is ESM but doesn't ship a build/package.json.
      // Mark the dir as ESM so Node skips the reparse-from-CJS warning when
      // application.js (CJS) dynamic-imports it.
      writeFileSync(
        join(workdir, 'build', 'package.json'),
        JSON.stringify({ type: 'module' }, null, 2) + '\n'
      );
      rmSync(workNative, { recursive: true, force: true });
    } else if (config.type === 'nextjs') {
      const nextOut = join(workNative, '.next');
      if (!existsSync(nextOut)) {
        throw new Error(`Expected next build output at ${nextOut} but didn't find it.`);
      }
      // pnpm's isolated install leaves workdir/native/node_modules full of
      // symlinks pointing up into workdir/node_modules/.pnpm — that breaks
      // require() once the tree is asar-bundled. `pnpm deploy` rewrites the
      // tree with all prod deps fully inlined and devDeps stripped, using
      // --node-linker=hoisted so node_modules is flat (no .pnpm subdir).
      const deployDir = join(workdir, '.fsn-native-deploy');
      run('pnpm', ['--filter', 'native', 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', deployDir], { cwd: workdir });
      // `pnpm deploy` only copies the package's published files (package.json,
      // README, etc.), not build artifacts or static assets. Layer those back
      // on so the runtime can find .next/, public/, and next.config.*.
      cpSync(nextOut, join(deployDir, '.next'), { recursive: true });
      for (const dir of ['public', 'src']) {
        const src = join(workNative, dir);
        if (existsSync(src)) cpSync(src, join(deployDir, dir), { recursive: true });
      }
      for (const cfg of ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next-env.d.ts', 'tsconfig.json']) {
        const src = join(workNative, cfg);
        if (existsSync(src)) cpSync(src, join(deployDir, cfg));
      }
      rmSync(workNative, { recursive: true, force: true });
      renameSync(deployDir, workNative);
      // Strip dev-only / SCM noise that snuck through copyTree's filter.
      for (const junk of ['.git', '.gitignore', 'README.md', 'AGENTS.md', 'CLAUDE.md']) {
        rmSync(join(workNative, junk), { recursive: true, force: true });
      }
    }
    // Clear consumer-only files at workdir root (their package.json,
    // fsn.config.js, pnpm-workspace.yaml, .gitignore, …) and any prior
    // build output, but keep the artifacts the runtime needs:
    //   - sveltekit: only 'build/' (adapter-node's output is self-contained;
    //     its server deps are bundled inline by esbuild).
    //   - nextjs:    'native/' (.next + public + src + package.json) plus
    //     'node_modules/' (pnpm's isolated install — workdir/native/node_modules
    //     is full of symlinks pointing up here, so removing it would break
    //     `next` resolution at runtime).
    const keepAtRoot = config.type === 'sveltekit'
      ? new Set(['build'])
      : new Set(['native']);
    for (const entry of readdirSync(workdir)) {
      if (!keepAtRoot.has(entry)) {
        rmSync(join(workdir, entry), { recursive: true, force: true });
      }
    }

    // 4. Write the Electron main process
    writeFileSync(
      join(workdir, 'application.js'),
      buildApplicationJs(basename(cwd), config.type)
    );

    // 5. Write a package.json for the Electron app and install Electron +
    //    @electron/packager. We use npm here (not pnpm) because the workdir
    //    is throwaway and npm doesn't gate Electron's post-install download.
    const appName = sanitizeAppName(basename(cwd));
    writeFileSync(
      join(workdir, 'package.json'),
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

    // 6. Package the app
    const platform = process.platform === 'darwin' ? 'darwin'
      : process.platform === 'win32' ? 'win32' : 'linux';
    run('npx', ['--yes', '@electron/packager', '.', appName,
      '--out', 'dist',
      '--overwrite',
      '--platform', platform,
      '--arch', process.arch,
    ], { cwd: workdir });

    // 7. Copy result back to ./dist
    const projectDist = join(cwd, 'dist');
    if (existsSync(projectDist)) {
      rmSync(projectDist, { recursive: true, force: true });
    }
    cpSync(join(workdir, 'dist'), projectDist, { recursive: true });

    log(`✓ Built native app at ${projectDist}`);
  } finally {
    // Keep workdir on failure so it can be inspected; remove on success.
    // (Skipped: the throw path leaves workdir intact, the success path falls
    // through to here. We intentionally don't auto-delete to make debugging
    // easier — temp dirs get cleaned up by the OS eventually.)
  }
}

async function loadConfig(cwd) {
  const configPath = join(cwd, 'fsn.config.js');
  if (!existsSync(configPath)) {
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
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d, exclude);
    } else if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(s), d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function buildApplicationJs(projectName, framework) {
  // Framework-specific snippet that initializes `runHandler` — a normalized
  // (req, res) => Promise<void> wrapper around whatever the framework hands
  // us. Both adapter-node's handler (Polka middleware) and Next's custom-
  // server handler take a Node IncomingMessage + ServerResponse pair, so
  // the Web↔Node shim below is shared.
  const initBlock = framework === 'sveltekit' ? `
const { pathToFileURL } = require('node:url');

async function initHandler() {
  // adapter-node's handler.js is ESM, so we need dynamic import.
  const handlerUrl = pathToFileURL(path.join(__dirname, 'build', 'handler.js'));
  const mod = await import(handlerUrl.href);
  const handler = mod.handler;
  return (req, res) => new Promise((resolve, reject) => {
    res._endPromise.then(resolve, reject);
    try {
      handler(req, res, (err) => {
        if (err) { reject(err); return; }
        if (!res._done) {
          res.statusCode = 404;
          res.end('Not found');
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}` : `
const { createRequire } = require('node:module');

async function initHandler() {
  // next is CJS; resolve it against the bundled native/ project so its
  // own deps (react, react-dom, etc.) come from native/node_modules.
  const nativeDir = path.join(__dirname, 'native');
  const nativeRequire = createRequire(path.join(nativeDir, 'package.json'));
  const next = nativeRequire('next');
  const factory = next.default || next;
  const nextApp = factory({ dev: false, dir: nativeDir });
  await nextApp.prepare();
  const handler = nextApp.getRequestHandler();
  return (req, res) => Promise.resolve(handler(req, res)).then(() => res._endPromise);
}`;

  return `'use strict';

// Electron main process. Intercepts every same-origin http request via
// protocol.handle, shims the Web Request/Response pair into Node Incoming-
// Message/ServerResponse, and runs the framework's handler against them.
// No port, no subprocess — the framework's "server" is just a module we
// import and call.

const path = require('node:path');
const { Readable } = require('node:stream');
const { app, BrowserWindow, protocol, net } = require('electron');

const APP_HOST = 'app.localhost';
const APP_ORIGIN = 'http://' + APP_HOST;

// === Web -> Node IncomingMessage shim ===
// The framework handlers want a real-ish IncomingMessage: a Readable stream
// with method/url/headers/socket. We synthesize one over the Web Request's
// body stream, with just enough surface to satisfy adapter-node's getRequest()
// and next.js's request preprocessing.
function toNodeRequest(webRequest, url) {
  const body = webRequest.body
    ? Readable.fromWeb(webRequest.body)
    : Readable.from([]);
  const headers = {};
  for (const [k, v] of webRequest.headers) headers[k.toLowerCase()] = v;
  Object.assign(body, {
    method: webRequest.method,
    url: url.pathname + url.search,
    headers,
    rawHeaders: Object.entries(headers).flatMap(([k, v]) => [k, v]),
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    complete: false,
    socket: { encrypted: false, remoteAddress: '127.0.0.1', remotePort: 0 },
    connection: { encrypted: false, remoteAddress: '127.0.0.1', remotePort: 0 },
  });
  return body;
}

// === Node ServerResponse stand-in ===
// Captures statusCode/headers/body the way @sveltejs/kit/node's setResponse
// and Next.js write to it, then exposes _endPromise so the caller can await
// completion and read the captured state. Not a real Writable — we only
// implement the subset the frameworks touch.
class CaptureResponse {
  constructor() {
    this.statusCode = 200;
    this.statusMessage = '';
    this.headersSent = false;
    this._headers = new Map();
    this._chunks = [];
    this._done = false;
    this._endPromise = new Promise((resolve, reject) => {
      this._resolveEnd = resolve;
      this._rejectEnd = reject;
    });
  }
  setHeader(name, value) { this._headers.set(name.toLowerCase(), value); return this; }
  getHeader(name)        { return this._headers.get(name.toLowerCase()); }
  getHeaders()           { return Object.fromEntries(this._headers); }
  hasHeader(name)        { return this._headers.has(name.toLowerCase()); }
  removeHeader(name)     { this._headers.delete(name.toLowerCase()); }
  appendHeader(name, value) {
    const k = name.toLowerCase();
    const existing = this._headers.get(k);
    if (existing == null) this._headers.set(k, value);
    else if (Array.isArray(existing)) this._headers.set(k, existing.concat(value));
    else this._headers.set(k, [existing].concat(value));
    return this;
  }
  writeHead(status, statusMessage, headers) {
    this.statusCode = status;
    if (typeof statusMessage === 'string') {
      this.statusMessage = statusMessage;
    } else {
      headers = statusMessage;
    }
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    } else if (headers) {
      for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    }
    this.headersSent = true;
    return this;
  }
  flushHeaders() { this.headersSent = true; }
  // Node-internal hooks the http module calls before serializing headers.
  // Next.js's compiled handlers go through these directly; faking them as
  // no-ops keeps the response capture happy.
  _implicitHeader() { this.headersSent = true; }
  _writeRaw(_chunk, _encoding, cb) { if (cb) cb(); return true; }
  _storeHeader() { this.headersSent = true; }
  addTrailers() {}
  setTimeout() { return this; }
  cork() {}
  uncork() {}
  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk != null) {
      if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding || 'utf8');
      else if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
      this._chunks.push(chunk);
    }
    if (cb) cb();
    return true;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk != null) this.write(chunk, encoding);
    if (!this._done) {
      this._done = true;
      this._resolveEnd();
    }
    if (cb) cb();
    return this;
  }
  on(event, listener) {
    if (event === 'close' || event === 'finish') this._endPromise.then(listener);
    return this;
  }
  once(event, listener) { return this.on(event, listener); }
  off()                 { return this; }
  removeListener()      { return this; }
  emit()                { return false; }
  destroy(err) {
    if (this._done) return this;
    this._done = true;
    if (err) this._rejectEnd(err);
    else this._resolveEnd();
    return this;
  }
  get writable()         { return !this._done; }
  get writableEnded()    { return this._done; }
  get writableFinished() { return this._done; }
  get finished()         { return this._done; }
}

function captureToResponse(res) {
  const headers = new Headers();
  for (const [k, v] of res._headers) {
    if (Array.isArray(v)) for (const vv of v) headers.append(k, String(vv));
    else headers.set(k, String(v));
  }
  const body = res._chunks.length === 0 ? null : Buffer.concat(res._chunks);
  return new Response(body, {
    status: res.statusCode,
    statusText: res.statusMessage || undefined,
    headers,
  });
}
${initBlock}

let runHandler;
const handlerReady = initHandler().then((fn) => { runHandler = fn; });

async function invokeHandler(webRequest, url) {
  await handlerReady;
  const req = toNodeRequest(webRequest, url);
  const res = new CaptureResponse();
  await runHandler(req, res);
  return captureToResponse(res);
}

app.whenReady().then(async () => {
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
    try {
      return await invokeHandler(request, url);
    } catch (err) {
      console.error('[fsn] handler error:', err);
      return new Response('Internal error: ' + (err && err.stack || err), {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  });

  await handlerReady;

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
