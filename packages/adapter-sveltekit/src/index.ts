import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import type { Adapter } from '@sveltejs/kit';

const files = fileURLToPath(new URL('../files', import.meta.url));

export type AdapterOptions = {
  /** Output directory, relative to the SvelteKit project. Defaults to `build`. */
  out?: string;
};

/**
 * SvelteKit adapter for FSN.
 *
 * Emits `<out>/index.js`, an ES module whose default export is an FSN host:
 * `{ fetch(request: Request): Promise<Response> }`. The FSN main process hands
 * it the web `Request`s it intercepts and returns the `Response` straight to
 * the window — no HTTP server, no sockets.
 *
 * Static assets and prerendered pages are served from `<out>/client` and
 * `<out>/prerendered`; everything else goes to SvelteKit's `Server.respond`.
 *
 * Like adapter-node, the server is bundled with everything in
 * devDependencies, while packages in `dependencies` stay external — put
 * native addons and anything else that can't be bundled there. `fsn build`
 * installs those next to `<out>` with `pnpm deploy --prod`.
 */
export function adapter({ out = 'build' }: AdapterOptions = {}): Adapter {
  return {
    name: '@fsn.dev/adapter-sveltekit',

    async adapt(builder) {
      // SvelteKit 3 exposes config on `config` directly (and warns on reading
      // `config.kit`); SvelteKit 2 nests it under `config.kit`.
      const config = builder.config as typeof builder.config & { paths?: { base: string } };
      const base = (config.paths ?? config.kit.paths).base;
      const tmp = builder.getBuildDirectory('fsn');

      builder.rimraf(out);
      builder.rimraf(tmp);
      builder.mkdirp(tmp);

      builder.log.minor('Copying assets');
      // URL pathname (decoded, including base) → file path relative to `out`.
      const statics = new Map<string, string>();
      for (const file of builder.writeClient(`${out}/client`)) {
        statics.set(`${base}/${file}`, `client/${file}`);
      }
      for (const file of builder.writePrerendered(`${out}/prerendered`)) {
        statics.set(`${base}/${file}`, `prerendered/${file}`);
      }
      // Prerendered pages are requested without their .html extension.
      for (const [path, { file }] of builder.prerendered.pages) {
        statics.set(path, `prerendered/${file}`);
      }

      builder.log.minor('Building server');
      const server = builder.getServerDirectory();
      builder.copy(`${files}/entry.js`, `${tmp}/entry.js`, {
        replace: {
          __FSN_BASE__: JSON.stringify(base),
          __FSN_STATICS__: JSON.stringify([...statics]),
          __FSN_PAGES__: JSON.stringify([...builder.prerendered.pages.keys()]),
        },
      });

      // Dependencies can have deep imports (`pkg/sub/path`), hence the regex.
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      const external = Object.keys(pkg.dependencies ?? {}).map(
        (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`)
      );

      const bundle = await rolldown({
        input: { index: `${tmp}/entry.js` },
        platform: 'node',
        external,
        plugins: [
          {
            name: 'fsn:sveltekit-server',
            resolveId(id) {
              if (id === 'SERVER') return `${server}/index.js`;
              if (id === 'MANIFEST') return `${server}/manifest.js`;
            },
          },
        ],
      });
      await bundle.write({
        dir: out,
        format: 'esm',
        sourcemap: true,
        chunkFileNames: 'server/[name]-[hash].js',
      });
      await bundle.close();

      // So Node treats the output as ESM regardless of the enclosing package.
      writeFileSync(`${out}/package.json`, JSON.stringify({ type: 'module' }, null, 2) + '\n');
    },

    supports: {
      read: () => true,
    },
  };
}

export default adapter;
