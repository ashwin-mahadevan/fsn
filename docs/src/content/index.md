---
title: FSN
description: FSN (Full-Stack Native) packages a SvelteKit or Next.js app as a native desktop app, with no ports and no custom IPC.
---

FSN, short for Full-Stack Native, turns a full-stack web app into a native desktop app. You write an ordinary [SvelteKit](https://svelte.dev/docs/kit) or [Next.js](https://nextjs.org) app, server code and all, and FSN packages it with [Electron](https://www.electronjs.org).

What sets it apart is how a window reaches your server. There's no local web server and no port. FSN hands each request from the window straight to your server code, inside the same process, which means:

- **Your app works as it does on the web.** Server-side rendering, form actions, API routes, cookies and streamed responses need no changes, and nothing has to be exported as static files.
- **There's no IPC to write.** Pages talk to their server with links, forms and `fetch`, as they always have.
- **Nothing listens on the network.** No other program on the machine can reach your server.

## Quick start

You'll need [Node.js](https://nodejs.org) 22 or newer and [pnpm](https://pnpm.io).

```sh
npx @fsn.dev/cli init --project my-app --framework sveltekit
cd my-app
pnpm install
pnpm build
```

The app is written to `dist/`, built for the platform and architecture you ran the build on. On an Apple-silicon Mac, that's `dist/my-app-darwin-arm64/my-app.app`.

Pass `--framework nextjs` for a Next.js app instead.

## What you get

`fsn init` creates a pnpm workspace:

```text
my-app/
├── fsn.config.js        # names your hosts
├── package.json         # "build": "fsn build"
├── pnpm-workspace.yaml
└── native/              # the SvelteKit or Next.js app
```

`native/` is a normal SvelteKit or Next.js project. Work on it the way you would any other, with its dev server in a browser, and run `pnpm build` in the project root when you want the native app.

## Where to next

- [How it works](/how-it-works) follows a request from a window to your server.
- [Hooks](/hooks) run your own code in the app's main process: to set a menu, keep the app to one instance, or tidy up before it quits.
- [CLI](/cli) and [Configuration](/configuration) cover `fsn init`, `fsn build` and `fsn.config.js`.
