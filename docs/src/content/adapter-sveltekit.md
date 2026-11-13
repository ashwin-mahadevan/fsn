---
title: SvelteKit adapter
description: The adapter that builds a SvelteKit app into a host FSN can serve in-process.
---

A SvelteKit app needs an [adapter](https://svelte.dev/docs/kit/adapters) for wherever it runs. [`@fsn.dev/adapter-sveltekit`](https://www.npmjs.com/package/@fsn.dev/adapter-sveltekit) is the one for FSN. It builds the app into a module that takes a `Request` and returns a `Response`, which is all the app's main process [needs to serve it](/how-it-works#requests).

## Setting it up

[`fsn init --framework sveltekit`](/cli#fsn-init) does this for you. To do it by hand in an existing SvelteKit app, install the adapter:

```sh
pnpm add -D @fsn.dev/adapter-sveltekit
```

Then use it in place of the adapter the app has:

```js title="svelte.config.js"
import adapter from '@fsn.dev/adapter-sveltekit';

export default {
  kit: {
    adapter: adapter(),
  },
};
```

It works with SvelteKit 2 and 3. A SvelteKit 3 app that keeps its configuration in `vite.config.ts` passes the adapter there instead:

```ts title="vite.config.ts"
import adapter from '@fsn.dev/adapter-sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
```

## Dependencies

Where a package is listed in the host's `package.json` decides how it reaches the app:

| Listed under      | In the app                                                 |
| ----------------- | ---------------------------------------------------------- |
| `devDependencies` | Bundled into the server when the host is built             |
| `dependencies`    | Left as an import, and installed in the app by `fsn build` |

Most packages can go in either. A package that can't be bundled has to be in `dependencies`, which mainly means those with native addons.

## What gets served

Static assets and prerendered pages are served from files. Every other request goes to SvelteKit's server, so server-side rendering, endpoints, form actions and hooks behave as they do under any other adapter.

Some values are fixed, since there's no network between the window and the server:

- `event.getClientAddress()` returns `127.0.0.1`.
- `event.platform` is an empty object.
- Environment variables come from the environment of the app's process.

[`read`](https://svelte.dev/docs/kit/$app-server#read) from `$app/server` is supported.

## Options

### `out`

The directory to build into, relative to the SvelteKit project. It defaults to `build`.

```js
adapter({ out: 'build' });
```

[`fsn build`](/cli#fsn-build) looks for the host's build in `build`, so leave this at its default in an FSN project.
