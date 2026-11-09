import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { handler } = await import(pathToFileURL(path.join(__dirname, 'build', 'handler.js')).href);

export default { handler };
