---
title: CLI
description: The fsn command. How to run it, and what fsn init and fsn build do.
---

The `fsn` command is published as [`@fsn.dev/cli`](https://www.npmjs.com/package/@fsn.dev/cli). It needs Node.js 22 or newer, and uses [pnpm](https://pnpm.io) to install and build your hosts.

## Running it

### Without installing

Outside a project, as for `fsn init`, run the package directly. Everything after its name is passed to `fsn`:

```sh
npx @fsn.dev/cli --help
```

```sh
pnpm dlx @fsn.dev/cli --help
```

### Inside a project

A project created by `fsn init` has `@fsn.dev/cli` as a dev dependency, so the `fsn` command is there:

```sh
pnpm exec fsn --help
```

In the scripts of a `package.json`, `fsn` works as it is. The generated project has `"build": "fsn build"`, so `pnpm build` runs `fsn build`.

To add the CLI to a project that wasn't created by `fsn init`, install it with `pnpm add -D @fsn.dev/cli`.

## `fsn init`

```sh
fsn init [--project <dir>] [--framework <sveltekit|nextjs>]
```

Creates a new FSN project.

| Option        | Default  | What it sets                                             |
| ------------- | -------- | -------------------------------------------------------- |
| `--project`   | `.`      | The directory to create. It must be missing or empty.    |
| `--framework` | `nextjs` | The framework of the app's host: `sveltekit` or `nextjs` |

The project is a pnpm workspace, with the app itself in `native/`:

```text
my-app/
├── fsn.config.js        # names your hosts
├── package.json         # "build": "fsn build"
├── pnpm-workspace.yaml
└── native/              # the SvelteKit or Next.js app
```

`native/` comes from the framework's own generator: `sv create` for SvelteKit, `create-next-app` for Next.js. For SvelteKit, `fsn init` then swaps `@sveltejs/adapter-auto` for [`@fsn.dev/adapter-sveltekit`](/adapter-sveltekit).

FSN's packages are added with `pnpm add`, so pnpm picks their versions and installs the project's dependencies. The project is ready for `pnpm build`.

## `fsn build`

```sh
fsn build
```

Builds the project in the current directory into a native app. Run it from the project root, where `fsn.config.js` is. It:

1. Builds every host listed in [`fsn.config.js`](/configuration), with the host's own `build` script.
2. Collects each host's build output and production dependencies.
3. Bundles [`fsn.ts`](/hooks), if the project has one.
4. Packages everything with [Electron Packager](https://github.com/electron/packager).
5. Copies the app to `dist/`, replacing what was there.

The app is built for the platform and architecture that the build runs on, and is named after the project's directory. A project in `my-app/`, built on an Apple-silicon Mac, becomes `dist/my-app-darwin-arm64/my-app.app`.

## `fsn --help`

Prints the commands and their options. `fsn -h`, and `fsn` on its own, do the same.
