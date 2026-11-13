/**
 * The site's pages, in sidebar order. A page at `/a/b` is written in
 * `src/content/a/b.md` (and `/` in `src/content/index.md`), so adding a page
 * is a Markdown file plus an entry here. The build fails if the two disagree.
 */
export type NavPage = {
	/** The page's label in the sidebar and in the previous/next links. */
	title: string;
	/** As in the address bar. `resolve()` takes it without the slash: `resolve(path.slice(1))`. */
	path: `/${string}`;
};

export type NavSection = {
	title: string;
	pages: NavPage[];
};

export const sections: NavSection[] = [
	{
		title: 'Getting started',
		pages: [
			{ title: 'Introduction', path: '/' },
			{ title: 'How it works', path: '/how-it-works' }
		]
	},
	{
		title: 'Hooks',
		pages: [
			{ title: 'Overview', path: '/hooks' },
			{ title: 'Reference', path: '/hooks/reference' },
			{ title: 'Recipes', path: '/hooks/recipes' }
		]
	},
	{
		title: 'Reference',
		pages: [
			{ title: 'CLI', path: '/cli' },
			{ title: 'Configuration', path: '/configuration' },
			{ title: 'SvelteKit adapter', path: '/adapter-sveltekit' }
		]
	}
];

export const pages: NavPage[] = sections.flatMap((section) => section.pages);
