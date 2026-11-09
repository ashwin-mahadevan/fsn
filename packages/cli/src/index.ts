export type Config =
  | { type: 'sveltekit' | 'nextjs' }
  | { hosts: Record<string, string> };
