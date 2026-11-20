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
| `packages/cli/`               | `@fsn.dev/cli`: the `fsn` command, the `Config` and `Hooks` types |
| `packages/adapter-sveltekit/` | `@fsn.dev/adapter-sveltekit`: SvelteKit adapter for FSN        |
| `packages/adapter-nextjs/`    | `@fsn.dev/adapter-nextjs`: Next.js adapter for FSN (experimental) |
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
- The docs' pages are Markdown in `docs/src/content/`, listed in
  `docs/src/lib/nav.ts`. `pnpm build` there fails on a broken internal link or
  anchor, so run it after changing a page.
- Packages are published to npm. Bump the version in a package's
  `package.json` when its published behavior changes.

## Checks and releases

No GitHub workflow checks a change. `./checks.sh` runs every check a change
has to pass, and is run before the change is merged.

- `./checks.sh` builds the packages, lints, checks and builds the docs, and
  packages the SvelteKit and Next.js examples end to end. A new check goes
  into that script.
- To release a package, bump its `version` in the change. Nothing runs
  `./release.sh` by itself: whoever merges runs it from the merged commit,
  right after the merge. It publishes each version that isn't on npm yet (a
  prerelease goes to the `next` dist-tag) and creates its GitHub release,
  tagged `<name>@<version>`. A merge that doesn't bump a version publishes
  nothing. A package with `"private": true` is skipped.
- Nobody else runs `./release.sh`, and nobody runs `npm publish`,
  `gh release create`, `vercel deploy` or the publish workflow by hand.
- `release.sh` publishes through `.github/workflows/publish.yml`, which runs
  only when started. npm trusts that workflow file by name (trusted
  publishing), so don't rename it.
- The docs site deploys to Vercel from `master` (project `fsn.dev`, root
  `docs/`), and Vercel builds a preview of each pushed branch. That's Vercel's
  Git integration, not a workflow here.
