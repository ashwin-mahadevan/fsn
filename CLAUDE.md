# FSN (Full-Stack Native)

An open-source project maintained by Ashwin Mahadevan. FSN packages a full-stack
web app (SvelteKit or Next.js) as a native Electron app by serving HTTP over
Electron's protocol handler instead of TCP, so the app needs no custom IPC.

**This repo is public.** Everything committed here, including commit messages,
issues and PRs, is visible to anyone. Never bring in code or details from the
private XTerm.app repo.

## Layout

| Folder                        | What it is                                                     |
| ----------------------------- | -------------------------------------------------------------- |
| `packages/cli/`               | `@fsn.dev/cli`: the `fsn` command and the `Config` type        |
| `packages/adapter-sveltekit/` | `@fsn.dev/adapter-sveltekit`: SvelteKit adapter for FSN        |
| `docs/`                       | The documentation site (SvelteKit)                             |
| `examples/`                   | `sveltekit`, `nextjs` and `multi-host` example apps            |

Examples link to the local CLI (`link:../../packages/cli`), so they exercise
unpublished changes. Build one with `pnpm build` inside its folder.

`PROMPT.md` is the original design brief. Parts of it are out of date (paths,
the single-file CLI), so trust the code over it.

## Tooling

- `mise` pins node and pnpm.
- `sharedWorkspaceLockfile` is off: each package and example has its own pnpm
  lockfile. Install and run scripts from inside the folder you are changing.
- Packages build with `pnpm build` (`tsc`). In `docs/`, run `pnpm format`,
  `pnpm lint` and `pnpm check`.
- Packages are published to npm. Bump the version in a package's
  `package.json` when its published behavior changes.

## CI/CD

- `.github/workflows/checks.yml` runs on every PR: builds both packages,
  lints/checks/builds the docs, and packages the SvelteKit example end to end.
- `.github/workflows/publish.yml` runs on every push to `master`. Any package
  whose `package.json` version isn't on npm yet is published (after the checks
  pass) and gets a GitHub release tagged `<name>@<version>`. Prerelease
  versions go to the `next` dist-tag. Auth is npm trusted publishing.
- The docs site deploys to Vercel from `master` (project `fsn.dev`, root
  `docs/`), with preview deploys on PRs. That's Vercel's Git integration, not a
  workflow here.
