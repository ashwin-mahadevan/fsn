---
title: Hooks
description: Run your own code in the app's main process by exporting hooks from fsn.ts.
---

Your pages and server code cover most of an app. Some things belong to the app itself rather than to any page: its menu, what happens when the last window closes, whether a second copy may start. Those are decided in Electron's main process, which FSN [writes for you](/how-it-works). **Hooks** are how you add your own code to it.

## Writing hooks

Create `fsn.ts` in the project root, next to `fsn.config.js`. Each function it exports is a hook, which FSN calls at one point in the app's life:

```ts title="fsn.ts"
import { app, nativeTheme } from 'electron';
import type { Hooks } from '@fsn.dev/cli';

// Before the first window opens: use the dark appearance throughout.
export const ready: Hooks['ready'] = () => {
  nativeTheme.themeSource = 'dark';
};

// When the last window closes: quit, on macOS too.
export const windowAllClosed: Hooks['windowAllClosed'] = () => {
  app.quit();
};
```

There's nothing to register. [`fsn build`](/cli#fsn-build) finds the file and bundles it into the app, and the app loads it when it starts.

The `Hooks` type gives each hook its parameter types. For it to work, and for Electron's own types, add Electron to the project root:

```sh
pnpm add -D electron
```

That copy is only there for its types. The app is built with the Electron version the CLI uses, whichever one you install.

### In JavaScript

The file can be `fsn.js` instead, with the same types through JSDoc. If a project has both, FSN uses `fsn.ts`.

```js title="fsn.js"
import { app } from 'electron';

/** @type {import('@fsn.dev/cli').Hooks['windowAllClosed']} */
export const windowAllClosed = () => {
  app.quit();
};
```

## The hooks

| Hook                                                            | Called when                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`ready`](/hooks/reference#ready)                               | The app has started and is serving its hosts, before the first windows open |
| [`activate`](/hooks/reference#activate)                         | macOS: the app is activated, for example from the Dock                      |
| [`windowAllClosed`](/hooks/reference#windowAllClosed)           | The last window closes                                                      |
| [`beforeQuit`](/hooks/reference#beforeQuit)                     | The app is about to close its windows and quit                              |
| [`willQuit`](/hooks/reference#willQuit)                         | Every window has closed and the app is about to quit                        |
| [`quit`](/hooks/reference#quit)                                 | The app is quitting                                                         |
| [`openUrl`](/hooks/reference#openUrl)                           | macOS: the app is asked to open a URL                                       |
| [`openFile`](/hooks/reference#openFile)                         | macOS: the app is asked to open a file                                      |
| [`secondInstance`](/hooks/reference#secondInstance)             | Another copy of the app is started while this one holds the lock            |
| [`browserWindowCreated`](/hooks/reference#browserWindowCreated) | A window is created                                                         |
| [`webContentsCreated`](/hooks/reference#webContentsCreated)     | A window's web contents are created                                         |

They come in three kinds:

- **`ready` is FSN's own.** It runs at the one moment only FSN knows about: after your hosts are up, before the windows are.
- **`activate` and `windowAllClosed` replace a default.** FSN handles both events itself unless you export the hook, and then yours runs instead.
- **The rest are listeners.** Each listens to the event on Electron's [`app`](https://www.electronjs.org/docs/latest/api/app#events) that it's named after, in camel case, and is called with that event's arguments: `beforeQuit` is the listener for `before-quit`.

The [reference](/hooks/reference) describes each one, and the [recipes](/hooks/recipes) show them at work.

## When hooks run

1. **`fsn.ts` loads.** Its top-level code runs before Electron is ready, and the listener hooks start listening.
2. **Electron becomes ready.** FSN loads your hosts and starts serving them at `http://<host-name>.localhost/`.
3. **`ready` runs.** FSN waits for it to finish.
4. **FSN opens a window for each host.** `webContentsCreated` and then `browserWindowCreated` are called for each one, as they are for any window opened later.
5. **The app runs.** `activate` and `windowAllClosed` are in effect from here on.
6. **The app quits.** `beforeQuit` is called, the windows close, then `willQuit` and `quit` are called.

`openUrl`, `openFile` and `secondInstance` are called whenever their event happens. For the first two that can be as early as step 1, when opening a link or a file is what started the app. The [reference](/hooks/reference#openUrl) shows how to handle that.

## What fsn.ts can do

`fsn.ts` is ordinary main-process code, so anything Electron lets the main process do is open to it.

### Use Electron

Import from `electron` as in any Electron app: `app`, `BrowserWindow`, `Menu`, `dialog`, `shell` and the rest.

### Run code before the app is ready

The file is loaded before Electron's `ready` event, so its top-level code is the place for calls that have to come first, such as [`app.requestSingleInstanceLock()`](/hooks/recipes#allow-only-one-instance).

### Open windows

Every window in the app can load a host, not only the ones FSN opens. From `ready` on:

```ts
const settings = new BrowserWindow({ width: 480, height: 640 });
settings.loadURL('http://native.localhost/settings');
```

### Call a host

From `ready` on, `fetch` reaches a host in-process, the same way its windows do:

```ts
const response = await fetch('http://native.localhost/api/status');
```

Use this, not an `import`, to reach a host's server code. `fsn.ts` is bundled separately from the hosts, so importing a host's module gets a second copy of it, with its own state.

### Listen to other events

A hook exists for the events most apps need. For any other, call Electron's own `app.on` at the top level:

```ts
app.on('render-process-gone', (_event, _webContents, details) => {
  console.error('A window crashed:', details.reason);
});
```

> [!NOTE]
> Export `activate` and `windowAllClosed` as hooks instead of listening for them with `app.on`. A listener you add runs alongside FSN's default; only the hook replaces it.

### Import other files and packages

They're bundled in with `fsn.ts`, so it can share code with the rest of the project. Packages with native addons can't be bundled: keep those in a host.

## Good to know

- **Only hooks can be exported.** `fsn build` fails if `fsn.ts` exports any other name, a default export included, and lists the names it accepts. A misspelt hook stops the build instead of never being called.
- **The build doesn't check types.** `fsn build` strips the types from `fsn.ts` without checking them, so a type error shows up in your editor but doesn't stop the build.
- **Hooks only run in the built app.** Your framework's dev server doesn't know about `fsn.ts`. To try a change, build the app again.
