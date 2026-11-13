---
title: How it works
description: What's inside an FSN app. The main process, hosts and windows, and how a request gets from a window to your server.
---

An FSN app is an Electron app whose main process is written by FSN. That one process runs your server code and opens your windows. This page describes what it does, which is worth knowing before you [hook into it](/hooks).

## Hosts

A **host** is a SvelteKit or Next.js package that the app serves. [`fsn.config.js`](/configuration) gives each one a name:

```js title="fsn.config.js"
/** @type {import('@fsn.dev/cli').Config} */
export default {
  hosts: {
    native: './native',
  },
};
```

Inside the app, a host named `native` is at `http://native.localhost/`. Most apps have a single host. An app can have several, each at its own origin and each with its own window.

## Requests

FSN handles the `http:` scheme itself, with Electron's [`protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler). When a window requests a URL at `http://<host-name>.localhost`, FSN passes the request to that host's server as a standard [`Request`](https://developer.mozilla.org/docs/Web/API/Request), and gives the window the [`Response`](https://developer.mozilla.org/docs/Web/API/Response) that comes back.

The request never leaves the process: no port is open, and there is nothing for another program to connect to. Requests to any other address, such as an API on the internet, go out over the network as usual.

A browser's network stack does some work that a request handled this way would miss, so FSN does it instead:

- **Cookies.** A `Set-Cookie` header from a host is stored in the app's cookie store, and sent back in the `Cookie` header of later requests.
- **`Origin` and `Referer`.** FSN sets both on the requests it passes on, so checks that rely on them, like SvelteKit's CSRF protection, work.
- **Requests from the server to itself.** When code in the main process fetches a host's URL, FSN answers that in-process too. That covers server code calling its own origin, and [`fetch` in a hook](/hooks#call-a-host).

## Startup

When the app starts, FSN's main process:

1. Loads the project's [`fsn.ts`](/hooks), if it has one.
2. Waits for Electron to be ready.
3. Loads each host's server and starts serving it.
4. Calls the [`ready`](/hooks/reference#ready) hook.
5. Opens a window for each host, at `http://<host-name>.localhost/`.

From then on it follows the conventions of the platform. Closing the last window quits the app, except on macOS, where the app stays running and reopens its windows when it's activated. [Hooks](/hooks) can change both.

## Files and data

A built app shouldn't write inside its own folder: it may be installed somewhere read-only, and on macOS changing it breaks the app's code signature.

For data that has to outlive a session, FSN sets `process.env.FSN_DATA_DIR` to the app's per-user data folder, the one Electron calls [`userData`](https://www.electronjs.org/docs/latest/api/app#appgetpathname). On macOS that's `~/Library/Application Support/<app-name>`. Server code can keep its files there, such as a SQLite database:

```ts
import { join } from 'node:path';

const database = join(process.env.FSN_DATA_DIR ?? '.', 'app.db');
```

The variable is only set in the built app, so give it a fallback for when the host runs under its dev server.
