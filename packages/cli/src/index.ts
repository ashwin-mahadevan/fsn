export type Config = {
  /**
   * Host name → path (relative to fsn.config.js) of a SvelteKit or Next.js
   * package. Each host gets a window at `http://<host-name>.localhost/`.
   */
  hosts: Record<string, string>;

  /**
   * Path (relative to fsn.config.js) to the app icon, passed to
   * @electron/packager. Give it without an extension and the packager picks
   * the platform's own file next to it: `.icon` (Icon Composer) or `.icns` on
   * macOS, `.ico` on Windows. Linux apps get no embedded icon; desktop
   * environments take one from an icon theme instead.
   */
  icon?: string;
};

/**
 * What `fsn build` generates for each host (app/<name>/fsn.host.mjs). The
 * FSN main process passes it each request made to `http://<name>.localhost`.
 */
export type Host = {
  fetch(request: Request): Response | Promise<Response>;
};

export type { Hooks } from './hooks.js';
