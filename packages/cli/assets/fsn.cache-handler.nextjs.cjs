// FSN cache handler for Next.js (`cacheHandler` in the runtime config).
//
// Next's default FileSystemCache writes ISR / revalidation results into
// `.next/`, which in a packaged app sits inside the app bundle: often not
// writable (e.g. in /Applications), and writing there would break its code
// signature. This
// is the same cache with an overlay filesystem: writes go to a per-host,
// per-build directory under Electron's userData; reads look there first and
// fall back to the build-time files in `.next/`.

const fs = require('node:fs');
const path = require('node:path');
const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache').default;

const hostDir = __dirname;
const nextDir = path.join(hostDir, '.next');

function cacheDir() {
  const dataDir = process.env.FSN_DATA_DIR;
  if (!dataDir) return null;
  // Namespace by build so an app update never serves the previous build's pages.
  const buildId = fs.readFileSync(path.join(nextDir, 'BUILD_ID'), 'utf8').trim();
  return path.join(dataDir, 'next-cache', path.basename(hostDir), buildId);
}

/** A CacheFs whose writes land in `overlayDir` and whose reads prefer it. */
function overlayFs(baseFs, overlayDir) {
  const toOverlay = (file) => {
    const rel = path.relative(nextDir, file);
    return rel.startsWith('..') || path.isAbsolute(rel) ? null : path.join(overlayDir, rel);
  };
  const preferOverlay = (file) => {
    const overlay = toOverlay(file);
    return overlay && fs.existsSync(overlay) ? overlay : file;
  };
  return {
    existsSync: (file) => fs.existsSync(preferOverlay(file)),
    readFile: (file, ...rest) => baseFs.readFile(preferOverlay(file), ...rest),
    readFileSync: (file, ...rest) => baseFs.readFileSync(preferOverlay(file), ...rest),
    stat: (file) => baseFs.stat(preferOverlay(file)),
    writeFile: (file, data) => baseFs.writeFile(toOverlay(file) ?? file, data),
    mkdir: (dir) => baseFs.mkdir(toOverlay(dir) ?? dir),
  };
}

class FsnCacheHandler extends FileSystemCache {
  constructor(ctx) {
    const dir = cacheDir();
    super(dir && ctx.fs ? { ...ctx, fs: overlayFs(ctx.fs, dir) } : ctx);
  }
}

module.exports = FsnCacheHandler;
