// FSN host for Next.js. Default export: { fetch(request: Request): Promise<Response> }.
//
// Next.js only exposes a Node-style (req, res) handler, so this wraps it in an
// http.Server that never listens and feeds it each Request over an in-memory
// socket pair. Node's own HTTP parser does the req/res plumbing.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { Duplex, Readable } from 'node:stream';
import next from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Boot from the config Next serialized at build time, the way the standalone
// server.js does: next()'s `conf` option is ignored by the router server it
// starts, but __NEXT_PRIVATE_STANDALONE_CONFIG isn't. next.config.* isn't
// loaded at runtime.
const { config } = JSON.parse(
  readFileSync(path.join(__dirname, '.next', 'required-server-files.json'), 'utf8')
);
// fsn build stages a cache handler that writes ISR results to userData
// instead of the read-only app bundle.
const cacheHandler = path.join(__dirname, 'fsn.cache-handler.cjs');
if (existsSync(cacheHandler)) config.cacheHandler = cacheHandler;

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
const nextApp = next({ dev: false, dir: __dirname });
await nextApp.prepare();
// Next caches the loaded config per app directory; don't leak it to other hosts.
delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG;
const handle = nextApp.getRequestHandler();

const server = http.createServer((req, res) => handle(req, res));

/** A Duplex that passes for a net.Socket; writes go to its peer. */
class InProcessSocket extends Duplex {
  constructor() {
    super({ allowHalfOpen: true });
    this.peer = null;
    this.connecting = false;
    this.pending = false;
    this.encrypted = false;
    this.remoteAddress = '127.0.0.1';
    this.remotePort = 0;
    this.localAddress = '127.0.0.1';
    this.localPort = 0;
    this.bytesRead = 0;
    this.bytesWritten = 0;
  }

  _read() {}

  _write(chunk, _encoding, callback) {
    this.bytesWritten += chunk.length;
    this.peer.push(chunk);
    callback();
  }

  setKeepAlive() { return this; }
  setNoDelay() { return this; }
  setTimeout() { return this; }
  ref() { return this; }
  unref() { return this; }
  address() { return { address: '127.0.0.1', family: 'IPv4', port: 0 }; }

  destroySoon() {
    if (this.writable) this.end();
    if (this.writableFinished) this.destroy();
    else this.once('finish', () => this.destroy());
  }
}

function createSocketPair() {
  const a = new InProcessSocket();
  const b = new InProcessSocket();
  a.peer = b;
  b.peer = a;
  a.on('finish', () => b.push(null));
  b.on('finish', () => a.push(null));
  return [a, b];
}

export default {
  /** @param {Request} request */
  fetch(request) {
    const url = new URL(request.url);
    return new Promise((resolve, reject) => {
      const [serverSocket, clientSocket] = createSocketPair();
      server.emit('connection', serverSocket);

      const nodeRequest = http.request({
        createConnection: (_options, callback) => {
          process.nextTick(callback, null, clientSocket);
          return clientSocket;
        },
        method: request.method,
        path: url.pathname + url.search,
        // A fetch Request has no Host header; without one Node sends
        // `localhost`, and Next builds its own origin (e.g. for server action
        // redirects) from it.
        headers: { ...Object.fromEntries(request.headers), host: url.host },
      }, (nodeResponse) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(nodeResponse.headers)) {
          if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
          else if (value != null) headers.set(key, value);
        }
        const status = nodeResponse.statusCode ?? 200;
        // Response() rejects a body for HEAD and null-body statuses.
        const hasBody = request.method !== 'HEAD' && ![101, 204, 205, 304].includes(status);
        if (!hasBody) nodeResponse.resume();
        resolve(new Response(hasBody ? Readable.toWeb(nodeResponse) : null, { status, headers }));
      });

      nodeRequest.on('error', reject);

      if (request.body) Readable.fromWeb(request.body).pipe(nodeRequest);
      else nodeRequest.end();
    });
  },
};
