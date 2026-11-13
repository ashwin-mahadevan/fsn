import { pages } from '#lib/nav.ts';
import { render, type Rendered } from './markdown.ts';

export type Doc = Rendered & {
	title: string;
	description: string;
};

// path ('/hooks/reference') → Markdown source, front matter included.
const sources = new Map(
	Object.entries(
		import.meta.glob<string>('/src/content/**/*.md', {
			query: '?raw',
			import: 'default',
			eager: true
		})
	).map(([file, source]) => [
		file.replace(/^\/src\/content/, '').replace(/(\/index)?\.md$/, '') || '/',
		source
	])
);

// A page missing from the sidebar can't be found, and a sidebar entry without
// a page is a broken link: stop the build on either.
for (const { path } of pages) {
	if (!sources.has(path))
		throw new Error(`nav.ts lists ${path}, which has no page in src/content.`);
}
for (const path of sources.keys()) {
	if (!pages.some((page) => page.path === path)) {
		throw new Error(`src/content has a page for ${path}, which nav.ts doesn't list.`);
	}
}

/** Split a page's source into its front matter (`key: value` lines) and its Markdown. */
function parse(path: string, source: string): { meta: Record<string, string>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
	if (!match) throw new Error(`${path}: missing front matter.`);
	const meta: Record<string, string> = {};
	for (const line of match[1].split('\n')) {
		const colon = line.indexOf(':');
		if (colon === -1) throw new Error(`${path}: can't read the front matter line "${line}".`);
		meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return { meta, body: source.slice(match[0].length) };
}

const docs = new Map<string, Doc>();

/** The rendered page at `path`, or undefined if there's no such page. */
export function getDoc(path: string): Doc | undefined {
	const source = sources.get(path);
	if (source === undefined) return undefined;

	let doc = docs.get(path);
	if (!doc) {
		const { meta, body } = parse(path, source);
		if (!meta.title || !meta.description) {
			throw new Error(`${path}: the front matter needs a title and a description.`);
		}
		doc = { title: meta.title, description: meta.description, ...render(body) };
		docs.set(path, doc);
	}
	return doc;
}
