import { app, BrowserWindow, protocol, net, session } from 'electron';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SAME_SITE = { strict: 'strict', lax: 'lax', none: 'no_restriction' };

/** Apply one Set-Cookie header from a host response to Electron's cookie store. */
async function storeSetCookie(cookies, url, header) {
  const [pair, ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return;
  const cookie = { url, name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
  let expired = false;

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'path') cookie.path = value;
    else if (key === 'domain') cookie.domain = value;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite') cookie.sameSite = SAME_SITE[value.toLowerCase()] ?? 'unspecified';
    else if (key === 'max-age') {
      // Max-Age wins over Expires (RFC 6265 §5.3).
      const seconds = Number(value);
      if (seconds <= 0) expired = true;
      else cookie.expirationDate = Date.now() / 1000 + seconds;
    } else if (key === 'expires' && cookie.expirationDate === undefined) {
      const time = Date.parse(value);
      if (!Number.isNaN(time)) {
        if (time <= Date.now()) expired = true;
        else cookie.expirationDate = time / 1000;
      }
    }
  }

  try {
    if (expired) {
      const scope = new URL(url);
      if (cookie.path) scope.pathname = cookie.path;
      await cookies.remove(scope.href, cookie.name);
    } else {
      await cookies.set(cookie);
    }
  } catch (err) {
    console.error(`[fsn] couldn't store cookie "${cookie.name}" from ${url}:`, err);
  }
}

// fsn build stages everything under app/ alongside this file.
const appDir = path.join(app.getAppPath(), 'app');

// The project's fsn.ts, bundled by fsn build: its named exports are hooks into
// the app's lifecycle. It loads here, before the app is ready (Electron waits
// for this module to finish loading), so its top-level code can do whatever
// must happen by then.
const hooksPath = path.join(appDir, 'fsn.mjs');
const { ready, activate, windowAllClosed, ...listeners } =
  existsSync(hooksPath) ? await import(pathToFileURL(hooksPath).href) : {};

// The other hooks are listeners for the app event they're named after:
// beforeQuit for 'before-quit'.
for (const [name, listener] of Object.entries(listeners)) {
  app.on(name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), listener);
}

app.whenReady().then(async () => {
  const configPath = path.join(appDir, 'fsn.config.js');
  const { default: config } = await import(pathToFileURL(configPath).href);

  // Where hosts may write at runtime (the app bundle itself is read-only).
  process.env.FSN_DATA_DIR = app.getPath('userData');

  const hosts = new Map();

  // Server code fetching its own origin (e.g. Next.js fetching the target of
  // a server action's redirect()) runs in this process, where requests don't
  // pass through protocol.handle. Send those to the host in-process as well.
  // Installed before hosts load so frameworks that wrap fetch wrap this one.
  const nodeFetch = globalThis.fetch;
  globalThis.fetch = async function fetch(input, init) {
    const href = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(href);
    const host = hosts.get(url.hostname);
    if (!host) return nodeFetch(input, init);

    const request = new Request(input, init);
    // Hosts are only served over http; server code may assume https.
    url.protocol = 'http:';
    const response = await host.fetch(new Request(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      duplex: 'half',
      redirect: request.redirect,
      signal: request.signal,
    }));

    const location = response.headers.get('location');
    if (request.redirect !== 'follow' || !REDIRECT_STATUSES.has(response.status) || !location) {
      return response;
    }
    // Follow redirects like fetch would; 303 (and 301/302 for POST) become GET.
    const keepMethod = response.status === 307 || response.status === 308 ||
      (request.method !== 'POST' && response.status !== 303);
    return globalThis.fetch(new URL(location, url), keepMethod ? {
      method: request.method, headers: request.headers, body: request.body, duplex: 'half',
    } : { headers: request.headers });
  };

  // fsn build stages each host at app/<name>/, with a generated
  // fsn.host.mjs that default-exports { fetch(request) => Response }.
  for (const name of Object.keys(config.hosts)) {
    const hostPath = path.join(appDir, name, 'fsn.host.mjs');
    const { default: host } = await import(pathToFileURL(hostPath).href);
    hosts.set(`${name}.localhost`, host);
  }

  // Requests to http://<name>.localhost go straight to that host in-process:
  // no port, no socket, not reachable from any other process.
  //
  // Chromium hands intercepted requests over without the headers its network
  // stack would add (Cookie, Origin, Referer), and ignores Set-Cookie on the
  // responses. So cookies go through the session's cookie store here, and
  // Origin/Referer are rebuilt from request.referrer, which Chromium sets and
  // a page can only shorten, never forge.
  const cookies = session.defaultSession.cookies;
  protocol.handle('http', async (request) => {
    const host = hosts.get(new URL(request.url).hostname);
    if (!host) return net.fetch(request, { bypassCustomProtocolHandlers: true });

    const headers = new Headers(request.headers);
    const jar = await cookies.get({ url: request.url });
    if (jar.length > 0) headers.set('cookie', jar.map((c) => `${c.name}=${c.value}`).join('; '));
    if (request.referrer && request.referrer !== 'about:client') {
      headers.set('referer', request.referrer);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        headers.set('origin', new URL(request.referrer).origin);
      }
    }

    const response = await host.fetch(new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      duplex: 'half',
      redirect: 'manual',
      signal: request.signal,
    }));

    for (const header of response.headers.getSetCookie()) {
      await storeSetCookie(cookies, request.url, header);
    }
    return response;
  });

  function openWindows() {
    for (const name of Object.keys(config.hosts)) {
      const win = new BrowserWindow({
        width: 1024,
        height: 768,
        title: name,
        webPreferences: { sandbox: true },
      });
      win.loadURL(`http://${name}.localhost/`);
    }
  }

  await ready?.();
  openWindows();

  // Registered only now: the hooks may open windows onto the hosts, which
  // aren't served any earlier.
  app.on('window-all-closed', windowAllClosed ?? (() => {
    if (process.platform !== 'darwin') app.quit();
  }));
  app.on('activate', activate ?? (() => {
    if (BrowserWindow.getAllWindows().length === 0) openWindows();
  }));
});
