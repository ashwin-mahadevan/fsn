---
title: Next.js adapter
description: The experimental adapter that builds a Next.js app into a host FSN can serve without Next.js's own server.
---

A Next.js host doesn't need an adapter. Without one, [`fsn build`](/cli#fsn-build) gives the app a host of its own, which starts Next.js's server inside the app's main process, on no port, and passes it each request.

[`@fsn.dev/adapter-nextjs`](https://www.npmjs.com/package/@fsn.dev/adapter-nextjs) is another way to serve the app. It uses Next.js's [adapter API](https://nextjs.org/docs/app/api-reference/config/next-config-js/adapterPath) to build the app into a module that takes a `Request` and returns a `Response`, as the [SvelteKit adapter](/adapter-sveltekit) does. That module calls the app's routes directly, with no Next.js server in between.

> [!WARNING]
> The adapter is experimental. It [leaves out](#limits) some of what Next.js's server does, and a new release of Next.js can break it. An app that runs into either can remove the adapter and go back to the built-in host.

## Setting it up

The adapter needs Next.js 16.2 or newer, the first release in which `adapterPath` is stable, and `@fsn.dev/cli` 0.3.1 or newer.

[`fsn init`](/cli#fsn-init) doesn't set it up. Install it in the host, which is `native/` in a project that `fsn init` created:

```sh
pnpm add -D @fsn.dev/adapter-nextjs
```

Then name it as the app's adapter:

```ts title="next.config.ts"
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  adapterPath: require.resolve('@fsn.dev/adapter-nextjs'),
};

export default nextConfig;
```

Nothing changes in [`fsn.config.js`](/configuration). `next build` now also writes the host's module, to `.next/fsn/index.mjs`. `fsn build` looks for it there and uses it. When it's missing, `fsn build` uses its built-in host instead.

## Dependencies

[`fsn build`](/cli#fsn-build) installs a host's `dependencies` in the app, and leaves out its `devDependencies`. The built app loads Next.js, React and the packages your code imports from there, so they have to be in `dependencies`. That's where `create-next-app` puts `next`, `react` and `react-dom`.

Packages that are only used to build can stay in `devDependencies`: TypeScript, for one, and this adapter.

All of this holds for the built-in host too.

## What gets served

The module does the part of `next start` that comes before a route runs:

- **Routing** is done by [`@next/routing`](https://www.npmjs.com/package/@next/routing), the router Next.js publishes for adapters. It covers the app's redirects, rewrites and headers, dynamic routes, the trailing slash, `basePath` and the proxy (middleware).
- **Static files** are served from disk: the ones in `.next/static` and `public/`, and prerendered pages.
- **Every other request** goes to the handler Next.js built for its route. That covers the pages and route handlers of the App Router, and the pages and API routes of the Pages Router. Responses stream as they're rendered.

Caching is still Next.js's own, so prerendered pages are regenerated as usual. A built app can't write inside its own folder, where `.next/` is, so the regenerated pages are kept under [`FSN_DATA_DIR`](/how-it-works#files-and-data), in `next-cache/`. The built-in host does the same.

## Limits

- **The Edge runtime.** The adapter can't run a route or a proxy that uses it. For such an app it prints a warning and writes no module, so `fsn build` uses its built-in host.
- **Image optimization.** The optimizer at `/_next/image` is part of Next.js's server, not of what an app is built into. The adapter turns on [`images.unoptimized`](https://nextjs.org/docs/app/api-reference/components/image#unoptimized), so `next/image` loads each image from its own URL. An app with an image loader of its own keeps it.
- **Static files** are always sent whole. `Range` requests, and conditional requests with `If-None-Match`, aren't handled.
- **Not tried yet:** `i18n`, Partial Prerendering, `output: 'export'`, and Windows.

The adapter also relies on a few of Next.js's internal modules, and `@next/routing` is experimental itself. Expect both to move with Next.js.
