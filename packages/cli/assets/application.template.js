import { app, BrowserWindow, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

app.whenReady().then(async () => {
  // fsn build stages everything under app/ alongside this file.
  const appDir = path.join(app.getAppPath(), 'app');
  const configPath = path.join(appDir, 'fsn.config.js');
  const { default: config } = await import(pathToFileURL(configPath).href);

  // Where hosts may write at runtime (the app bundle itself is read-only).
  process.env.FSN_DATA_DIR = app.getPath('userData');

  const hosts = new Map();
  const hostFor = (hostname) =>
    hostname.endsWith('.localhost') ? hosts.get(hostname.slice(0, -'.localhost'.length)) : undefined;

  // Server code fetching its own origin (e.g. Next.js fetching the target of
  // a server action's redirect()) runs in this process, where requests don't
  // pass through protocol.handle. Send those to the host in-process as well.
  // Installed before hosts load so frameworks that wrap fetch wrap this one.
  const nodeFetch = globalThis.fetch;
  globalThis.fetch = async function fetch(input, init) {
    const href = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(href);
    const host = hostFor(url.hostname);
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

  // fsn build stages each host at app/<name>/fsn.host.js, which
  // default-exports { fetch(request) => Response }.
  for (const name of Object.keys(config.hosts)) {
    const hostPath = path.join(appDir, name, 'fsn.host.js');
    const { default: host } = await import(pathToFileURL(hostPath).href);
    hosts.set(name, host);
  }

  // Requests to http://<name>.localhost go straight to that host in-process:
  // no port, no socket, not reachable from any other process.
  protocol.handle('http', (request) => {
    const host = hostFor(new URL(request.url).hostname);
    if (!host) return net.fetch(request, { bypassCustomProtocolHandlers: true });
    return host.fetch(request);
  });

  for (const name of Object.keys(config.hosts)) {
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      title: name,
      webPreferences: { sandbox: true },
    });
    win.loadURL(`http://${name}.localhost/`);
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
});
