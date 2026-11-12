import { join } from 'node:path';
import { build as esbuild } from 'esbuild';
import type { BrowserWindow, Event, WebContents } from 'electron';
import { exists, log } from './utils.js';

/**
 * The hooks a project's `fsn.ts` can export, each as a named export:
 *
 * ```ts
 * import type { Hooks } from '@fsn.dev/cli';
 *
 * export const beforeQuit: Hooks['beforeQuit'] = (event) => { ... };
 * ```
 *
 * Except for `ready`, each is a listener for the Electron `app` event of the
 * same name (`beforeQuit` for `before-quit`) and gets that event's arguments.
 */
export type Hooks = {
  /**
   * Called once the app is ready and its hosts are being served, before FSN
   * opens the first windows. FSN waits for a returned promise.
   */
  ready(): void | Promise<void>;
  /**
   * macOS: the app was activated, e.g. from the Dock. Replaces FSN's default,
   * which reopens the hosts' windows when none are open. Not called before
   * the first windows have opened.
   */
  activate(event: Event, hasVisibleWindows: boolean): void;
  /**
   * The last window closed. Replaces FSN's default, which quits the app
   * except on macOS.
   */
  windowAllClosed(): void;
  /** The app is about to close its windows to quit. `event.preventDefault()` cancels. */
  beforeQuit(event: Event): void;
  /** Every window has closed and the app will quit. `event.preventDefault()` cancels. */
  willQuit(event: Event): void;
  /** The app is quitting. */
  quit(event: Event, exitCode: number): void;
  /** macOS: the app was asked to open a URL with one of its schemes. */
  openUrl(event: Event, url: string): void;
  /** macOS: the app was asked to open a file. */
  openFile(event: Event, path: string): void;
  /** A second instance was launched while this one holds the single-instance lock. */
  secondInstance(event: Event, argv: string[], workingDirectory: string, additionalData: unknown): void;
  /** A window was created. */
  browserWindowCreated(event: Event, window: BrowserWindow): void;
  /** A window's (or webview's) contents were created. */
  webContentsCreated(event: Event, webContents: WebContents): void;
};

/**
 * Every hook, as the names fsn.ts may export. The main process works out each
 * one's event name itself (see application.template.js), so a hook added here
 * and to `Hooks` needs nothing else.
 */
const HOOKS: Record<keyof Hooks, true> = {
  ready: true,
  activate: true,
  windowAllClosed: true,
  beforeQuit: true,
  willQuit: true,
  quit: true,
  openUrl: true,
  openFile: true,
  secondInstance: true,
  browserWindowCreated: true,
  webContentsCreated: true,
};

/**
 * Bundle the project's fsn.ts (or fsn.js), if it has one, into `outfile` for
 * the main process to load. It's bundled rather than copied so it can be
 * TypeScript and can import the project's other files and dependencies.
 *
 * @param cwd      The user's project directory.
 * @param outfile  Where to write the bundle (an .mjs file).
 */
export async function bundleHooks(cwd: string, outfile: string): Promise<void> {
  let entry: string | undefined;
  for (const name of ['fsn.ts', 'fsn.js']) {
    if (await exists(join(cwd, name))) {
      entry = name;
      break;
    }
  }
  if (!entry) return;

  log(`bundling ${entry}`);
  const result = await esbuild({
    absWorkingDir: cwd,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    // Provided by the main process at runtime.
    external: ['electron'],
    // Bundled CommonJS dependencies still call require(), which ES modules
    // don't have.
    banner: {
      js: `import { createRequire as __fsnCreateRequire } from 'node:module';\n` +
        `const require = __fsnCreateRequire(import.meta.url);`,
    },
    metafile: true,
    logLevel: 'warning',
  });

  // A misspelt hook would otherwise never be called, without any error.
  const exported = Object.values(result.metafile.outputs).flatMap((output) => output.exports);
  const unknown = exported.filter((name) => !Object.hasOwn(HOOKS, name));
  if (unknown.length > 0) {
    throw new Error(
      `${entry} exports ${unknown.map((name) => `"${name}"`).join(', ')}, which FSN has no hook for. ` +
      `It can export: ${Object.keys(HOOKS).join(', ')}.`
    );
  }
}
