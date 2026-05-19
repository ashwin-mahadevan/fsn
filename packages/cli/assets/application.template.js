'use strict';

// Electron main process. Intercepts every same-origin http request via
// protocol.handle, shims the Web Request/Response pair into Node Incoming-
// Message/ServerResponse, and runs the framework's handler against them.
// No port, no subprocess — the framework's "server" is just a module we
// import and call.

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');
const { app, BrowserWindow, protocol, net } = require('electron');

const APP_HOST = 'app.localhost';
const APP_ORIGIN = 'http://' + APP_HOST;

// Tell adapter-node (and via it, SvelteKit) the canonical origin so its
// CSRF check + URL construction don't rely on per-request host derivation.
// next.js ignores this env var; the host-header fallback covers it.
process.env.ORIGIN = APP_ORIGIN;

// Logging — writes to stderr (visible when run from a terminal) and to
// {userData}/fsn.log so the trail is recoverable when the app was launched
// as a desktop entry. logFile is initialized lazily after app.whenReady()
// because app.getPath('userData') isn't available before then.
let logFile = null;
function log(...args) {
  const line = '[fsn ' + new Date().toISOString() + '] ' + args.map(String).join(' ') + '\n';
  process.stderr.write(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line); } catch (_) { /* best effort */ }
  }
}

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
  // Electron's protocol.handle doesn't always populate a host header (it's
  // implied by the URL), but SvelteKit's getRequest() and Next's request
  // preprocessing both refuse to parse a request without one — manifesting
  // as a generic 400 long before any of our route code runs.
  if (!headers.host) headers.host = url.host;
  // Same-origin by construction (protocol.handle only fires for APP_HOST),
  // so backfill Origin to match. Without this, SvelteKit's CSRF check
  // rejects every form POST with a 403.
  if (!headers.origin) headers.origin = 'http://' + url.host;
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

// fsn.handler.mjs is generated by 'fsn build' alongside the framework's
// runtime artifacts. It exports a single 'handler' whose signature matches
// whichever framework is in use: a Polka middleware (adapter-node) or an
// async (req, res) handler (next's getRequestHandler). The invocation logic
// below covers both shapes without branching.
let handler;
const handlerReady = (async () => {
  const handlerUrl = pathToFileURL(path.join(__dirname, 'app', 'fsn.handler.mjs'));
  const mod = await import(handlerUrl.href);
  handler = mod.handler;
})();

async function invokeHandler(webRequest, url) {
  await handlerReady;
  const req = toNodeRequest(webRequest, url);
  const res = new CaptureResponse();
  if (webRequest.method !== 'GET' && webRequest.method !== 'HEAD') {
    log('  shim headers:', JSON.stringify(req.headers));
  }
  // fsn.handler.mjs always exposes a (req, res) => Promise<void> contract,
  // so this is framework-agnostic.
  await handler(req, res);
  return captureToResponse(res);
}

app.whenReady().then(async () => {
  logFile = path.join(app.getPath('userData'), 'fsn.log');
  try { fs.writeFileSync(logFile, ''); } catch (_) { /* best effort */ }
  log('app ready, log file at', logFile);

  protocol.handle('http', async (request) => {
    const url = new URL(request.url);
    if (url.host.toLowerCase() !== APP_HOST) {
      log('pass-through', request.method, request.url);
      try {
        return await net.fetch(request, { bypassCustomProtocolHandlers: true });
      } catch (err) {
        log('pass-through error', err && err.stack || err);
        return new Response('Upstream fetch failed: ' + err.message, {
          status: 502,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    }
    log('->', request.method, url.pathname + url.search);
    try {
      const response = await invokeHandler(request, url);
      log('<-', response.status, request.method, url.pathname);
      if (response.status >= 400) {
        const reqHeaders = Object.fromEntries(request.headers);
        log('  request headers:', JSON.stringify(reqHeaders));
      }
      return response;
    } catch (err) {
      log('handler error', request.method, url.pathname, '-', err && err.stack || err);
      return new Response('Internal error: ' + (err && err.stack || err), {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  });

  try {
    await handlerReady;
    log('handler module loaded');
  } catch (err) {
    log('handler module failed to load:', err && err.stack || err);
  }

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: $$projectName,
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
