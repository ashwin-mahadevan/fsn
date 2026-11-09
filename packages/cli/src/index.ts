export type Config = {
  /**
   * Host name → path (relative to fsn.config.js) of a SvelteKit or Next.js
   * package. Each host gets a window at `http://<host-name>.localhost/`.
   */
  hosts: Record<string, string>;
};

/**
 * What `fsn build` generates for each host (app/<name>/fsn.host.mjs). The
 * FSN main process passes it each request made to `http://<name>.localhost`.
 */
export type Host = {
  fetch(request: Request): Response | Promise<Response>;
};
