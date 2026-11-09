import adapter from '@fsn.dev/adapter-sveltekit';

/** @type {import('@sveltejs/kit').Config} */
const config = { kit: { adapter: adapter() } };

export default config;
