import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextAdapter } from 'next';

const files = fileURLToPath(new URL('../files', import.meta.url));
const require = createRequire(import.meta.url);

/** The directory the host is written to, inside Next.js's `distDir`. */
const OUT = 'fsn';

/**
 * Next.js adapter for FSN. Set it as `adapterPath` in `next.config`:
 *
 * ```js
 * adapterPath: require.resolve('@fsn.dev/adapter-nextjs')
 * ```
 *
 * `next build` then also writes `<distDir>/fsn/index.mjs`, an ES module whose
 * default export is an FSN host: `{ fetch(request: Request): Promise<Response> }`.
 * The FSN main process hands it the web `Request`s it intercepts and returns
 * the `Response` straight to the window, with no HTTP server and no sockets.
 *
 * The module doesn't contain the app. It routes each request to one of the
 * modules `next build` wrote for the app's routes, so it has to stay where it
 * is in `distDir`, next to the app's `node_modules` (it loads `next` from
 * there). `fsn build` stages all of that.
 */
const adapter: NextAdapter = {
  name: '@fsn.dev/adapter-nextjs',

  modifyConfig(config, { phase }) {
    if (phase !== 'phase-production-build') return config;
    // `next/image` asks the server at /_next/image to resize each image. That
    // optimizer is part of `next start`, not of anything a build hands an
    // adapter, so have images load from their own URLs instead.
    if (config.images.loader === 'default' && !config.images.unoptimized) {
      return { ...config, images: { ...config.images, unoptimized: true } };
    }
    return config;
  },

  onBuildComplete({ routing, outputs, projectDir, distDir, config, buildId }) {
    const out = path.join(distDir, OUT);
    rmSync(out, { recursive: true, force: true });

    const routes = [...outputs.pages, ...outputs.pagesApi, ...outputs.appPages, ...outputs.appRoutes];

    // The Edge runtime's modules need Next.js's sandbox to run in, which only
    // its own server sets up. Leave such an app to `fsn build`'s built-in host.
    const edge = [...routes, ...(outputs.middleware ? [outputs.middleware] : [])]
      .filter((output) => output.runtime === 'edge');
    if (edge.length > 0) {
      console.warn(
        `[@fsn.dev/adapter-nextjs] Not writing ${path.relative(projectDir, out)}: ` +
        `${edge.map((output) => output.pathname).join(', ')} ` +
        `${edge.length === 1 ? 'uses' : 'use'} the Edge runtime, which this adapter can't run. ` +
        `fsn build will serve this app with its built-in host instead.`
      );
      return;
    }

    // The host finds everything relative to itself, so that the build can be
    // moved into an app bundle.
    const relative = (file: string) => path.relative(out, file).split(path.sep).join('/');

    /** URL pathname → the module of the route that handles it. */
    const functions: Record<string, string> = {};
    for (const route of routes) functions[route.pathname] = relative(route.filePath);

    /** URL pathname → the file to serve for it. */
    const statics: Record<string, string> = {};
    // Next.js doesn't list public/ among the build's outputs.
    const publicDir = path.join(projectDir, 'public');
    if (existsSync(publicDir)) {
      for (const entry of readdirSync(publicDir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = path.join(entry.parentPath, entry.name);
        const pathname = path.relative(publicDir, file).split(path.sep).join('/');
        statics[encodeURI(`${config.basePath}/${pathname}`)] = relative(file);
      }
    }
    for (const file of outputs.staticFiles) statics[file.pathname] = relative(file.filePath);

    const manifest = {
      buildId,
      basePath: config.basePath,
      i18n: config.i18n ?? undefined,
      routing,
      functions,
      statics,
      middleware: outputs.middleware && {
        file: relative(outputs.middleware.filePath),
        matchers: outputs.middleware.config.matchers ?? [{ sourceRegex: '.*' }],
      },
      projectDir: relative(projectDir) || '.',
      distDir: relative(distDir),
    };

    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, 'index.mjs'),
      readFileSync(path.join(files, 'entry.js'), 'utf8')
        .replace('__FSN_MANIFEST__', () => JSON.stringify(manifest, null, 2))
    );
    copyFileSync(path.join(files, 'cache-handler.cjs'), path.join(out, 'cache-handler.cjs'));
    // The router Next.js publishes for adapters: one file, no dependencies.
    copyFileSync(require.resolve('@next/routing'), path.join(out, 'routing.cjs'));

    console.log(`  Wrote the FSN host to ${path.relative(projectDir, out)}`);
  },
};

export default adapter;
