---
title: Hook recipes
description: Complete fsn.ts files for common jobs. A custom menu, a single-instance app, external links, clean-up on quit, and a remembered window size.
---

Each recipe below is a complete [`fsn.ts`](/hooks). They use a host named `native`, the name [`fsn init`](/cli#fsn-init) gives it.

To use several at once, merge them into one file. A hook can be exported only once, so two recipes that both export `ready` become one `ready` that does both jobs.

## Set the application menu

Electron gives every app a default menu. To replace it, build your own in [`ready`](/hooks/reference#ready), since Electron can't set a menu before the app is ready:

```ts title="fsn.ts"
import { Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { Hooks } from '@fsn.dev/cli';

const template: MenuItemConstructorOptions[] = [
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
  {
    role: 'help',
    submenu: [
      {
        label: 'Documentation',
        click: () => shell.openExternal('https://example.com/docs'),
      },
    ],
  },
];

// The menu named after the app, which only macOS has. It has to come first.
if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });

export const ready: Hooks['ready'] = () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
```

To have no menu bar at all on Windows and Linux, call `Menu.setApplicationMenu(null)` instead.

## Allow only one instance

Starting the app a second time should usually bring the running copy forward, not start another. Electron's single-instance lock does this, and has to be asked for before the app is ready, which is when the top level of `fsn.ts` runs:

```ts title="fsn.ts"
import { app, BrowserWindow } from 'electron';
import type { Hooks } from '@fsn.dev/cli';

// A second copy doesn't get the lock, and quits here: before it has served
// a host or opened a window.
if (!app.requestSingleInstanceLock()) app.quit();

// Meanwhile, in the copy that was already running:
export const secondInstance: Hooks['secondInstance'] = () => {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
};
```

On macOS, opening an app that's already running from Finder or the Dock switches to it anyway. The lock covers the other ways to start it there, and every way on Windows and Linux.

## Open external links in the browser

By default a link to another site opens inside the app's window, in place of your app. This sends such links to the user's browser instead, and keeps the app's windows for its own pages:

```ts title="fsn.ts"
import { shell } from 'electron';
import type { Hooks } from '@fsn.dev/cli';

// The app's own pages. With more than one host, check for each of them.
const isOwnPage = (url: string) => new URL(url).hostname === 'native.localhost';

function openInBrowser(url: string) {
  // Hand over web links only, never file: or another app's scheme.
  if (/^https?:/.test(url)) shell.openExternal(url);
}

export const webContentsCreated: Hooks['webContentsCreated'] = (
  _event,
  webContents,
) => {
  // Links that ask for a new window: target="_blank" and window.open().
  webContents.setWindowOpenHandler(({ url }) => {
    if (isOwnPage(url)) return { action: 'allow' };
    openInBrowser(url);
    return { action: 'deny' };
  });

  // Links that would replace the page in this window.
  webContents.on('will-navigate', (event) => {
    if (isOwnPage(event.url)) return;
    event.preventDefault();
    openInBrowser(event.url);
  });
};
```

[`webContentsCreated`](/hooks/reference#webContentsCreated) is called for every page in the app, so the rule also holds in windows you open yourself.

## Clean up before quitting

Your server may have work to finish before the app goes away, like flushing a queue or closing a database. [`willQuit`](/hooks/reference#willQuit) is called once the windows are gone, while the hosts still answer requests.

Electron doesn't wait for a promise there, so the hook cancels the quit, lets the server finish, and then quits again:

```ts title="fsn.ts"
import { app } from 'electron';
import type { Hooks } from '@fsn.dev/cli';

let cleanedUp = false;

export const willQuit: Hooks['willQuit'] = (event) => {
  if (cleanedUp) return;

  // Hold the quit until the server is done. Quit either way, so that a
  // failed clean-up can't keep the app running without windows.
  event.preventDefault();
  fetch('http://native.localhost/api/shutdown', { method: 'POST' })
    .catch((error) => console.error('Clean-up failed:', error))
    .finally(() => {
      cleanedUp = true;
      // Not straight away: Electron ignores a quit that's asked for while it
      // is still handling the one this hook cancelled.
      setImmediate(() => app.quit());
    });
};
```

`/api/shutdown` is a route of your own, in the host.

## Remember the window's size

FSN opens each window at 1024 by 768. To bring back the size the user left it at, save the size when the window closes, and apply it in [`browserWindowCreated`](/hooks/reference#browserWindowCreated):

```ts title="fsn.ts"
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hooks } from '@fsn.dev/cli';

// In the app's own folder for per-user data.
const file = join(app.getPath('userData'), 'window-size.json');

export const browserWindowCreated: Hooks['browserWindowCreated'] = (
  _event,
  window,
) => {
  try {
    const { width, height } = JSON.parse(readFileSync(file, 'utf8'));
    window.setSize(width, height);
  } catch {
    // Nothing saved yet: keep the size the window was created with.
  }

  window.on('close', () => {
    const [width, height] = window.getSize();
    writeFileSync(file, JSON.stringify({ width, height }));
  });
};
```

This keeps one size for the whole app, which suits an app with a single window.
