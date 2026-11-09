export type Config = {
  hosts: Record<string, string>;
};

/**
 * The default export of an `fsn.host.js` file. The FSN main process passes it
 * each request the window makes to `http://<host-name>.localhost`.
 */
export type Host = {
  fetch(request: Request): Response | Promise<Response>;
};
