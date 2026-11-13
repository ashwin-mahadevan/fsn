---
title: Hooks reference
description: Every hook that fsn.ts can export. When each is called, what it's passed, and what FSN does without it.
---

Every hook is optional, and is a named export of [`fsn.ts`](/hooks). The `Hooks` type from `@fsn.dev/cli` has the signature of each:

```ts title="fsn.ts"
import type { Hooks } from '@fsn.dev/cli';

export const quit: Hooks['quit'] = (event, exitCode) => {
  console.log(`Quit with exit code ${exitCode}.`);
};
```

In the signatures below, `Event`, `BrowserWindow` and `WebContents` are Electron's types. The examples leave out the import of `Hooks`.

## `ready`

```ts
ready(): void | Promise<void>
```

Called once, when the app is ready and is serving its hosts, just before FSN opens the first windows. It's the place for set-up that the windows depend on, such as [the application menu](/hooks/recipes#set-the-application-menu).

If `ready` returns a promise, FSN waits for it before opening the windows. Keep the wait short: until it's over, the app is running with nothing on screen.

The hosts already answer requests when it's called, so `ready` can [call them with `fetch`](/hooks#call-a-host) and [open windows](/hooks#open-windows) of its own.

```ts
export const ready: Hooks['ready'] = async () => {
  // Have the server bring its database up to date before any page loads.
  await fetch('http://native.localhost/api/migrate', { method: 'POST' });
};
```

> [!WARNING]
> If `ready` throws, or its promise rejects, FSN doesn't open its windows, and the app is left running without any. Catch the errors that the app can carry on from.

This isn't Electron's `ready` event. A listener for that, or code that waits for `app.whenReady()`, runs earlier: before the hosts are being served.

## `activate`

```ts
activate(event: Event, hasVisibleWindows: boolean): void
```

**macOS only.** Called when the app is activated, for example when its Dock icon is clicked. It's the listener for Electron's [`activate`](https://www.electronjs.org/docs/latest/api/app#event-activate-macos) event.

Without this hook, FSN reopens the hosts' windows if none is open, which is what a Mac app that outlives its last window is expected to do. Exporting `activate` replaces that, so reopening a window becomes the hook's job:

```ts
import { BrowserWindow } from 'electron';

export const activate: Hooks['activate'] = (_event, hasVisibleWindows) => {
  if (hasVisibleWindows) return;
  const window = new BrowserWindow({ width: 1024, height: 768 });
  window.loadURL('http://native.localhost/');
};
```

FSN starts listening once it has opened the first windows, so the hook isn't called for the activation that comes with starting the app.

## `windowAllClosed`

```ts
windowAllClosed(): void
```

Called when the last window closes. It's the listener for Electron's [`window-all-closed`](https://www.electronjs.org/docs/latest/api/app#event-window-all-closed) event.

Without this hook, FSN quits the app, except on macOS, where apps usually stay running. Exporting `windowAllClosed` replaces that. To quit on macOS as well:

```ts
import { app } from 'electron';

export const windowAllClosed: Hooks['windowAllClosed'] = () => {
  app.quit();
};
```

A hook that does nothing keeps the app running on every platform.

The hook isn't called when the windows close because the app is quitting, as they do after <kbd>Cmd</kbd>+<kbd>Q</kbd> or `app.quit()`. That path leads to [`willQuit`](#willQuit).

## `beforeQuit`

```ts
beforeQuit(event: Event): void
```

Called when the app has been asked to quit, before it closes its windows. `event.preventDefault()` cancels the quit. It's the listener for Electron's [`before-quit`](https://www.electronjs.org/docs/latest/api/app#event-before-quit) event.

```ts
import { dialog } from 'electron';

export const beforeQuit: Hooks['beforeQuit'] = (event) => {
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    message: 'Quit while the export is still running?',
    buttons: ['Quit', 'Cancel'],
    cancelId: 1,
  });
  if (choice === 1) event.preventDefault();
};
```

## `willQuit`

```ts
willQuit(event: Event): void
```

Called when every window has closed and the app is about to quit. `event.preventDefault()` cancels the quit. It's the listener for Electron's [`will-quit`](https://www.electronjs.org/docs/latest/api/app#event-will-quit) event.

The hosts still answer `fetch` here, which makes it the place to have the server finish its work. The quit doesn't wait for a promise, though, so cancel it, do the work, and quit again: see [Clean up before quitting](/hooks/recipes#clean-up-before-quitting).

## `quit`

```ts
quit(event: Event, exitCode: number): void
```

Called as the app quits, with the code it exits with. It's the listener for Electron's [`quit`](https://www.electronjs.org/docs/latest/api/app#event-quit) event. The quit can't be cancelled any more, and the process ends straight after, so only synchronous work is certain to finish.

> [!NOTE]
> On Windows, Electron doesn't emit the three quit events when the app closes because the system is shutting down or restarting, or the user is logging out. So `beforeQuit`, `willQuit` and `quit` aren't called then.

## `openUrl`

```ts
openUrl(event: Event, url: string): void
```

**macOS only.** Called when the app is asked to open a URL, as when the user follows a link whose scheme the app handles. It's the listener for Electron's [`open-url`](https://www.electronjs.org/docs/latest/api/app#event-open-url-macos) event.

When following a link is what starts the app, the hook is called before `ready`: no host is being served yet, and no window exists. Keep the URL until then:

```ts
let started = false;
const waiting: string[] = [];

function handle(url: string) {
  // The app's own endpoint: its server decides what the link means.
  fetch('http://native.localhost/api/open-url', { method: 'POST', body: url });
}

export const openUrl: Hooks['openUrl'] = (event, url) => {
  event.preventDefault();
  if (started) handle(url);
  else waiting.push(url);
};

export const ready: Hooks['ready'] = () => {
  started = true;
  waiting.forEach(handle);
};
```

> [!NOTE]
> macOS only routes a scheme's links to an app whose `Info.plist` declares that scheme, under `CFBundleURLTypes`. `fsn build` has no option for declaring one, so an app gets links for a scheme of its own only once that key is added to the built app's `Info.plist`.

On Windows and Linux there is no such event. A link arrives as a command-line argument: in `process.argv` when it starts the app, and in the `argv` passed to [`secondInstance`](#secondInstance) when the app is already running.

## `openFile`

```ts
openFile(event: Event, path: string): void
```

**macOS only.** Called when the app is asked to open a file, as when one is dropped on its Dock icon. It's the listener for Electron's [`open-file`](https://www.electronjs.org/docs/latest/api/app#event-open-file-macos) event. Call `event.preventDefault()` to tell macOS that the app is handling the file.

Like [`openUrl`](#openUrl), it's called before `ready` when opening a file is what starts the app, and the same pattern keeps the path until the app can use it.

> [!NOTE]
> Finder offers an app for the file types its `Info.plist` declares, under `CFBundleDocumentTypes`. `fsn build` has no option for declaring them.

On Windows and Linux, the file's path arrives as a command-line argument, as described for [`openUrl`](#openUrl).

## `secondInstance`

```ts
secondInstance(
  event: Event,
  argv: string[],
  workingDirectory: string,
  additionalData: unknown,
): void
```

Called in the running app when the user starts a second copy of it, with that copy's command-line arguments and working directory. It's the listener for Electron's [`second-instance`](https://www.electronjs.org/docs/latest/api/app#event-second-instance) event.

Electron only emits the event in an app that has asked for the single-instance lock, so the hook goes together with a call to `app.requestSingleInstanceLock()` at the top of `fsn.ts`: see [Allow only one instance](/hooks/recipes#allow-only-one-instance). `additionalData` is whatever the second copy passed to that call.

## `browserWindowCreated`

```ts
browserWindowCreated(event: Event, window: BrowserWindow): void
```

Called for every window as it's created: the ones FSN opens for your hosts, and any you open yourself. It's the listener for Electron's [`browser-window-created`](https://www.electronjs.org/docs/latest/api/app#event-browser-window-created) event.

This is how to reach the windows FSN opens, which it creates at 1024 by 768 with Electron's default options:

```ts
export const browserWindowCreated: Hooks['browserWindowCreated'] = (
  _event,
  window,
) => {
  window.setMinimumSize(640, 480);
};
```

The window has only just been constructed, and hasn't loaded anything yet. What Electron fixes when a window is constructed, such as its frame and its `webPreferences`, can't be changed from here.

## `webContentsCreated`

```ts
webContentsCreated(event: Event, webContents: WebContents): void
```

Called for every web contents as it's created. That's the page inside each window, FSN's windows included, and for a window it's called just before [`browserWindowCreated`](#browserWindowCreated). It's the listener for Electron's [`web-contents-created`](https://www.electronjs.org/docs/latest/api/app#event-web-contents-created) event.

Use it for rules that should hold for every page, such as where links are allowed to lead: see [Open external links in the browser](/hooks/recipes#open-external-links-in-the-browser).
