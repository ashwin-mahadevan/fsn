import { app, BrowserWindow, protocol, net } from 'electron';
import http from 'node:http';
import { Duplex, Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// InProcessSocket — a Duplex that satisfies net.Socket's interface so that
// Node's http.Server and http.request treat it as a real connection.
// No OS socket, no port, not visible to any other process.
// ---------------------------------------------------------------------------
class InProcessSocket extends Duplex {
  constructor() {
    super({ allowHalfOpen: true });
    this._peer = null;
    this.connecting  = false;
    this.pending     = false;
    this.encrypted   = false;
    this.remoteAddress = '127.0.0.1';
    this.remotePort    = 0;
    this.localAddress  = '127.0.0.1';
    this.localPort     = 0;
    this.bytesRead     = 0;
    this.bytesWritten  = 0;
  }

  _read() {}

  _write(chunk, _enc, cb) {
    this.bytesWritten += chunk.length;
    this._peer.push(chunk);
    cb();
  }

  setKeepAlive() { return this; }
  setNoDelay()   { return this; }
  setTimeout()   { return this; }
  ref()          { return this; }
  unref()        { return this; }
  address()      { return { address: '127.0.0.1', family: 'IPv4', port: 0 }; }

  destroySoon() {
    if (this.writable) this.end();
    if (this.writableFinished) this.destroy();
    else this.once('finish', () => this.destroy());
  }
}

function createSocketPair() {
  const a = new InProcessSocket();
  const b = new InProcessSocket();
  a._peer = b;
  b._peer = a;
  a.on('finish', () => b.push(null));
  b.on('finish', () => a.push(null));
  return [a, b];
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // fsn build stages everything under app/ alongside this file.
  const appDir = path.join(app.getAppPath(), 'app');
  const configPath = path.join(appDir, 'fsn.config.js');
  const { default: config } = await import(pathToFileURL(configPath).href);

  const servers = new Map();

  for (const [name, hostRelPath] of Object.entries(config.hosts)) {
    // Tell adapter-node (SvelteKit) the canonical origin before importing so
    // its CSRF check and URL construction use the right value.
    process.env.ORIGIN = `http://${name}.localhost`;

    const hostAbsPath = path.resolve(appDir, hostRelPath);
    const { default: hostConfig } = await import(pathToFileURL(hostAbsPath).href);
    const { handler } = hostConfig;

    const server = http.createServer((req, res) => {
      handler(req, res, () => {
        if (!res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      });
    });
    servers.set(name, server);
  }

  protocol.handle('http', async (request) => {
    const url = new URL(request.url);

    if (!url.hostname.endsWith('.localhost')) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    const name = url.hostname.replace(/\.localhost$/, '');
    const server = servers.get(name);

    if (!server) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    return new Promise((resolve, reject) => {
      const [serverSocket, clientSocket] = createSocketPair();
      server.emit('connection', serverSocket);

      const nodeReq = http.request({
        createConnection: (_opts, cb) => { process.nextTick(cb, null, clientSocket); return clientSocket; },
        method:  request.method,
        path:    url.pathname + url.search,
        headers: Object.fromEntries(request.headers),
      }, (nodeResponse) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(nodeResponse.headers)) {
          if (Array.isArray(v)) v.forEach(vv => headers.append(k, vv));
          else if (v != null) headers.set(k, v);
        }
        resolve(new Response(Readable.toWeb(nodeResponse), {
          status: nodeResponse.statusCode ?? 200,
          headers,
        }));
      });

      nodeReq.on('error', reject);

      if (request.body) Readable.fromWeb(request.body).pipe(nodeReq);
      else nodeReq.end();
    });
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
