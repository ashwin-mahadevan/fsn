import { fileURLToPath } from 'node:url';
import path from 'node:path';
import next from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nextApp = next({ dev: false, dir: __dirname });
await nextApp.prepare();
const nextHandler = nextApp.getRequestHandler();

export default {
  handler: (req, res, _next) => nextHandler(req, res),
};
