---
title: Configuration
description: The options of fsn.config.js. The app's hosts and its icon.
---

`fsn.config.js` is in the project root, and its default export is the project's configuration. The `Config` type from `@fsn.dev/cli` describes it:

```js title="fsn.config.js"
/** @type {import('@fsn.dev/cli').Config} */
export default {
  hosts: {
    native: './native',
  },
  icon: './icon',
};
```

Code that runs in the app's main process doesn't go in this file. It goes in `fsn.ts`, next to it: see [Hooks](/hooks).

## `hosts`

**Required.** An object that maps the name of each host to the path of its package, relative to the config file.

A host is a SvelteKit or Next.js package. The path has to hold its `package.json`, and FSN tells the framework from that file's dependencies: `@sveltejs/kit` or `next`. A SvelteKit host has to use [`@fsn.dev/adapter-sveltekit`](/adapter-sveltekit). A Next.js host needs no changes.

The app serves each host at `http://<host-name>.localhost/`, and opens a window on it when it starts. So the name becomes part of your app's URLs, and is what [hooks](/hooks#call-a-host) use to reach the host.

An app can have more than one host, and they can use different frameworks:

```js title="fsn.config.js"
/** @type {import('@fsn.dev/cli').Config} */
export default {
  hosts: {
    sveltekit: './sveltekit',
    nextjs: './nextjs',
  },
};
```

Each host has to be a package in the project's pnpm workspace, which is how `fsn build` installs its production dependencies into the app.

## `icon`

**Optional.** The path of the app's icon, relative to the config file. It's passed to [Electron Packager](https://github.com/electron/packager).

Give the path without an extension, and the packager picks the right file for each platform from the ones next to it:

| Platform | File                                                         |
| -------- | ------------------------------------------------------------ |
| macOS    | `icon.icon` (an Icon Composer document), or `icon.icns`      |
| Windows  | `icon.ico`                                                   |
| Linux    | None. Desktop environments take the icon from an icon theme. |

With `icon: './icon'`, a build on macOS uses `icon.icon` or `icon.icns`, and a build on Windows uses `icon.ico`.
