# @fsn.dev/adapter-nextjs

Next.js adapter for [FSN](https://fsn.dev): serves your app from inside a native app's main process.

**Experimental.** It needs Next.js 16.2 or newer, the first release with a stable [`adapterPath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/adapterPath), and `@fsn.dev/cli` 0.3.1 or newer.

## Use

```sh
pnpm add -D @fsn.dev/adapter-nextjs
```

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  adapterPath: require.resolve('@fsn.dev/adapter-nextjs'),
};

export default nextConfig;
```

`next build` then also writes `.next/fsn/index.mjs`, a module whose default export is `{ fetch(request: Request): Promise<Response> }`. `fsn build` finds it there and has the app's main process import it. Without it (no adapter, or an older Next.js) `fsn build` serves the app with its built-in host, which starts Next.js's own server instead.

## How it works

A Next.js build leaves one module per route, each with a Node-style `handler(req, res, ctx)`. The adapter writes the part of `next start` that sits in front of them:

- **Routing** is [`@next/routing`](https://www.npmjs.com/package/@next/routing), the router Next.js publishes for adapters, given the `routing` tables of `onBuildComplete`. It covers redirects, rewrites, headers, dynamic routes, the trailing slash, `basePath` and the proxy (middleware). It is experimental, so expect it to move with Next.js.
- **Static files** (`.next/static`, prerendered files, `public/`) are served from disk.
- **Routes** are called with stand-ins for `req` and `res`, and what they write streams back as a `Response`. No HTTP server and no sockets.
- **Caching** is still Next.js's own. Each route's handler reads prerendered pages and regenerates them (ISR). The adapter gives it a cache handler that writes to `FSN_DATA_DIR` (the app's `userData`) instead of `.next/`, which is read-only inside a packaged app.

## What it doesn't do

- **The Edge runtime.** If a route or the proxy uses it, the adapter writes nothing and warns, and `fsn build` uses its built-in host.
- **Image optimization.** `/_next/image` is part of `next start`, not of the build output, so the adapter sets `images.unoptimized` and `next/image` loads images from their own URLs.
- **`Range` requests and conditional requests** (`If-None-Match`) for static files.
- Not tried yet: `i18n`, Partial Prerendering, `output: 'export'`, and Windows.

It also reaches into Next.js for three things an adapter has no public API for: `next/dist/build/adapter/setup-node-env.external` (the setup Next.js traces into every route for adapters to load first), `next/dist/server/lib/mock-request` (the `res` stand-in) and `next/dist/server/lib/incremental-cache/file-system-cache` (the cache it extends).
