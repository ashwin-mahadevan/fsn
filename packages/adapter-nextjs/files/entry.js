// FSN host entry, written by @fsn.dev/adapter-nextjs into <distDir>/fsn/.
// Default export: { fetch(request: Request): Promise<Response> }.
//
// A Next.js build leaves one module per route, each exporting a Node-style
// handler(req, res, ctx). This file is the part of `next start` that sits in
// front of them. It resolves each request to a route with @next/routing (the
// router Next.js publishes for adapters), serves static files itself, and
// calls the route's handler with stand-ins for req and res: no HTTP server
// and no sockets.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

// What the adapter recorded at build time. Every path is relative to this file.
const {
  buildId,
  basePath,
  i18n,
  // onBuildComplete's `routing`, unchanged.
  routing,
  // URL pathname → the module of the route that handles it.
  functions,
  // URL pathname → the file to serve for it.
  statics,
  // The proxy (middleware) module and its matchers, if the app has one.
  middleware,
  projectDir: relativeProjectDir,
  distDir: relativeDistDir,
} = __FSN_MANIFEST__;

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(here, relativeProjectDir);
const distDir = path.join(here, relativeDistDir);
const require = createRequire(import.meta.url);

// Next.js and React choose between their development and production builds
// by this when they first load. `next start` sets it too.
process.env.NODE_ENV = 'production';

// What Next.js has an adapter load before any route: AsyncLocalStorage and
// the other globals its server code expects.
require('next/dist/build/adapter/setup-node-env.external');
// The stand-in for http.ServerResponse that Next.js itself calls handlers
// with when it has no socket (e.g. to revalidate a page in-process).
const { MockedResponse } = require('next/dist/server/lib/mock-request');
const { resolveRoutes, responseToMiddlewareResult } = require('./routing.cjs');

const FUNCTIONS = new Map(Object.entries(functions));
const STATICS = new Map(Object.entries(statics));
const PATHNAMES = [...FUNCTIONS.keys(), ...STATICS.keys()];
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
// The routes that can render "not found", best first: the App Router's, then
// the Pages Router's.
const NOT_FOUND_PATHNAMES = ['/_not-found', '/404', '/_error'];
const NOT_FOUND = NOT_FOUND_PATHNAMES.find((pathname) => FUNCTIONS.has(pathname));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.rsc': 'text/x-component',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
};

// The config the build serialized, which a route's handler would otherwise
// read for itself. Handing it over here is what lets the cache handler be an
// absolute path: Next.js resolves the serialized (relative) one against the
// working directory, which in a packaged app is anywhere.
const { config } = JSON.parse(
  readFileSync(path.join(distDir, 'required-server-files.json'), 'utf8')
);
const nextConfig = {
  ...config,
  // Next.js's own cache writes regenerated pages into distDir, which is
  // inside the read-only app bundle. This one writes them where
  // FSN_DATA_DIR says.
  cacheHandler: config.cacheHandler
    ? path.resolve(distDir, config.cacheHandler)
    : path.join(here, 'cache-handler.cjs'),
};

// Where Next.js looks up per-project server state, keyed by the project's
// path relative to the working directory.
const ROUTER_SERVER_CONTEXTS = Symbol.for('@next/router-server-methods');

/** @returns the project directory as handlers want it: relative to the working directory. */
function registerProject() {
  const relative = path.relative(process.cwd(), projectDir) || '.';
  const contexts = (globalThis[ROUTER_SERVER_CONTEXTS] ??= {});
  contexts[relative] ??= { nextConfig };
  return relative;
}

/** Background work a handler starts (revalidation, `after()`): let it finish, and report if it fails. */
function waitUntil(promise) {
  Promise.resolve(promise).catch((error) => {
    console.error('[fsn] background work failed:', error);
  });
}

/** Load a route's module. Its `handler` export is what runs the route. */
async function load(file) {
  return await require(path.join(here, file));
}

/** @param {Record<string, string | string[]>} query */
function toSearch(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

/**
 * A stand-in for http.IncomingMessage: the request's body as a Node stream,
 * with the fields Next.js reads from a request.
 */
function toNodeRequest({ method, target, headers, body }) {
  const stream = body ? Readable.fromWeb(body) : Readable.from([]);
  return Object.assign(stream, {
    method,
    url: target,
    headers: Object.fromEntries(headers),
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    socket: { encrypted: false, remoteAddress: '127.0.0.1' },
  });
}

/**
 * Call a Node-style handler and return what it writes as a Response, as soon
 * as it has written the head. The body streams as the handler writes it.
 *
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<unknown>} run
 * @param {{ method: string, target: string, headers: Headers, body: ReadableStream | null,
 *           signal?: AbortSignal, status?: number, responseHeaders?: Headers }} init
 * @returns {Promise<Response>}
 */
function callNodeHandler(run, { method, target, headers, body, signal, status, responseHeaders }) {
  return new Promise((resolve, reject) => {
    /** @type {ReadableStreamDefaultController<Uint8Array>} */
    let controller;
    // Whether the head has gone to the window, and whether the body is over.
    let started = false;
    let closed = false;

    const req = toNodeRequest({ method, target, headers, body });
    const res = new MockedResponse({
      // Called with each chunk of the body. Like res.write(), it returns
      // whether the handler may keep writing without waiting for 'drain'.
      resWriter(chunk) {
        start();
        if (closed) return true;
        controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        return controller.desiredSize > 0;
      },
    });

    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
      // The window wants more: let a handler waiting on 'drain' continue.
      pull() {
        res.emit('drain');
      },
      // The window stopped reading. Next.js stops rendering on 'close'.
      cancel() {
        closed = true;
        res.destroy();
      },
    });

    // The head is final once the handler flushes it or writes any of the body.
    function start() {
      if (started) return;
      started = true;
      const hasBody = method !== 'HEAD' && !NULL_BODY_STATUSES.has(res.statusCode);
      if (!hasBody) close();
      resolve(new Response(hasBody ? stream : null, {
        status: res.statusCode,
        headers: res.headers,
      }));
    }
    function close() {
      if (closed) return;
      closed = true;
      controller.close();
    }

    res.flushHeaders = start;
    res.headPromise.then(start);
    res.once('finish', () => {
      start();
      close();
    });
    signal?.addEventListener('abort', () => res.destroy(), { once: true });

    // Headers the routes matched on the way here (`headers` in next.config,
    // the proxy). Set first, so the route can still override them.
    responseHeaders?.forEach((value, key) => {
      if (key === 'set-cookie') res.appendHeader(key, value);
      else res.setHeader(key, value);
    });
    if (status) res.statusCode = status;

    Promise.resolve(run(req, res)).catch((error) => {
      if (!started) return reject(error);
      if (closed) return;
      closed = true;
      controller.error(error);
    });
  });
}

/** Serve a file from the build output or public/. */
async function serveStatic(pathname, file, { method, status, responseHeaders }) {
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const body = await readFile(path.join(here, file));
  const headers = new Headers(responseHeaders);
  // A prerendered file's name isn't its URL: /favicon.ico is favicon.ico.body.
  const type =
    MIME_TYPES[path.extname(pathname).toLowerCase()] ??
    MIME_TYPES[path.extname(file).toLowerCase()] ??
    'application/octet-stream';
  headers.set('content-type', type);
  headers.set('content-length', String(body.byteLength));
  return new Response(method === 'HEAD' ? null : body, { status: status ?? 200, headers });
}

/** @param {Request} request */
async function respond(request) {
  const url = new URL(request.url);
  const method = request.method;
  const project = registerProject();

  let headers = new Headers(request.headers);
  // A fetch Request has no Host header, and Next.js builds its own origin
  // (e.g. for a server action's redirect) from it.
  headers.set('host', url.host);

  let body = request.body;
  /** @type {Response | undefined} What the proxy answered with, if it ran. */
  let proxied;

  /**
   * Call a route's handler for this request.
   * @param {string} pathname  The route's pathname, a key of FUNCTIONS.
   * @param {{ search?: string, status?: number, responseHeaders?: Headers }} [options]
   */
  const invoke = async (pathname, { search = url.search, status, responseHeaders } = {}) => {
    const { handler } = await load(FUNCTIONS.get(pathname));
    const ctx = {
      waitUntil,
      requestMeta: {
        relativeProjectDir: project,
        // The origin a route sees in its request's URL.
        hostname: url.host,
        // The Pages Router asks for the 404 page this way (`notFound: true`).
        render404: async (req, res) => {
          res.statusCode = 404;
          if (!NOT_FOUND) return void res.end('Not Found');
          const notFound = await load(FUNCTIONS.get(NOT_FOUND));
          await notFound.handler(req, res, ctx);
        },
      },
    };
    return callNodeHandler((req, res) => handler(req, res, ctx), {
      method,
      // The URL as the window requested it, so a rewritten route still
      // renders for the address the window shows. The query is the one the
      // router resolved: it carries what a rewrite adds, and a dynamic
      // route's parameters.
      target: url.pathname + search,
      headers,
      body,
      signal: request.signal,
      status,
      responseHeaders,
    });
  };

  const result = await resolveRoutes({
    url,
    buildId,
    basePath,
    i18n,
    headers,
    requestBody: body,
    pathnames: PATHNAMES,
    // The router calls invokeMiddleware for the requests these match.
    routes: { ...routing, middlewareMatchers: middleware?.matchers ?? [] },
    async invokeMiddleware(ctx) {
      // The proxy may read the body; the route still needs it afterwards.
      let proxyBody = null;
      if (body) [proxyBody, body] = body.tee();

      const mod = await load(middleware.file);
      proxied = await (mod.handler ?? mod)(
        new Request(ctx.url, {
          method,
          headers: ctx.headers,
          body: proxyBody,
          duplex: 'half',
          signal: request.signal,
        }),
        { waitUntil, requestMeta: { relativeProjectDir: project } }
      );
      const outcome = responseToMiddlewareResult(proxied, ctx.headers, ctx.url);
      // The request headers as the proxy left them, for the route.
      if (outcome.requestHeaders) headers = outcome.requestHeaders;
      return outcome;
    },
  });

  // The proxy answered the request itself.
  if (result.middlewareResponded && proxied) {
    const responseHeaders = new Headers(proxied.headers);
    responseHeaders.delete('x-middleware-next');
    responseHeaders.delete('x-middleware-refresh');
    return new Response(proxied.body, { status: proxied.status, headers: responseHeaders });
  }

  // The headers the matched routes set on the response (`headers` and
  // `redirects` in next.config, the proxy).
  const responseHeaders = result.resolvedHeaders ?? new Headers();

  // A redirect. The router reports one with a destination as `redirect`, and
  // any other (the proxy's, a trailing slash) as a status and Location header.
  const redirect = result.redirect?.url;
  const location = redirect
    ? redirect.origin === url.origin ? redirect.pathname + redirect.search + redirect.hash : redirect.href
    : responseHeaders.get('location');
  const redirectStatus = result.redirect?.status ?? result.status;
  if (location && redirectStatus >= 300 && redirectStatus < 400) {
    responseHeaders.set('location', location);
    return new Response(null, { status: redirectStatus, headers: responseHeaders });
  }

  // A rewrite to another origin: fetch it on the window's behalf.
  if (result.externalRewrite) {
    const forwarded = new Headers(headers);
    forwarded.delete('host');
    const response = await fetch(result.externalRewrite, {
      method,
      headers: forwarded,
      body,
      duplex: 'half',
      redirect: 'manual',
      signal: request.signal,
    });
    const merged = new Headers(response.headers);
    // fetch has already decoded the body.
    merged.delete('content-encoding');
    merged.delete('content-length');
    responseHeaders.forEach((value, key) => merged.set(key, value));
    return new Response(response.body, { status: response.status, headers: merged });
  }

  const pathname = result.resolvedPathname;
  if (pathname !== undefined) {
    const file = STATICS.get(pathname);
    if (file) return serveStatic(pathname, file, { method, status: result.status, responseHeaders });
    if (FUNCTIONS.has(pathname)) {
      return invoke(pathname, {
        search: toSearch(result.invocationTarget?.query ?? result.resolvedQuery ?? {}),
        status: result.status,
        responseHeaders,
      });
    }
  }

  // Nothing matched: answer 404 with the app's own "not found" page.
  for (const candidate of NOT_FOUND_PATHNAMES) {
    if (FUNCTIONS.has(candidate)) return invoke(candidate, { status: 404, responseHeaders });
    const file = STATICS.get(candidate);
    if (file) {
      const as = method === 'HEAD' ? 'HEAD' : 'GET';
      return serveStatic(candidate, file, { method: as, status: 404, responseHeaders });
    }
  }
  return new Response('Not Found', { status: 404, headers: responseHeaders });
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    try {
      return await respond(request);
    } catch (error) {
      // A route's handler answers 500 itself when the route throws. This is
      // for a failure outside of one.
      console.error(`[fsn] ${request.method} ${request.url} failed:`, error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
