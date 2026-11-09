import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export function log(...args: unknown[]): void {
  process.stderr.write('[fsn] ' + args.join(' ') + '\n');
}

export const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

export async function run(cmd: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  log('$', cmd, args.join(' '), options.cwd ? `(cwd=${options.cwd})` : '');
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...options });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${code}`);
  }
}

export async function renderTemplate(name: string, vars: Record<string, string>): Promise<string> {
  let src = await readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
  for (const [placeholder, value] of Object.entries(vars)) {
    src = src.replaceAll(placeholder, value);
  }
  return src;
}
