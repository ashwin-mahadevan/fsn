/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
	overrides: [
		{ files: '*.svelte', options: { parser: 'svelte' } },
		// The pages' code samples are formatted too: indented the way readers
		// expect to copy them, and narrow enough to fit the page without scrolling.
		{ files: '*.md', options: { useTabs: false, printWidth: 80, trailingComma: 'all' } }
	],
	tailwindStylesheet: './src/routes/layout.css'
};

export default config;
