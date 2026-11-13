import { Marked } from 'marked';
import { createHighlighter } from 'shiki';

/** A heading that the page's table of contents links to. */
export type Heading = {
	depth: 2 | 3;
	id: string;
	text: string;
};

export type Rendered = {
	html: string;
	headings: Heading[];
};

const THEMES = { light: 'github-light', dark: 'github-dark' };

// Every language a code fence may name. An unknown one fails the build, so a
// misspelt fence can't silently lose its highlighting.
const highlighter = await createHighlighter({
	themes: Object.values(THEMES),
	langs: ['ts', 'js', 'json', 'sh', 'yaml', 'svelte']
});

const CALLOUTS: Record<string, string> = { NOTE: 'Note', TIP: 'Tip', WARNING: 'Warning' };

const escape = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The text of a heading, from its Markdown source: without code ticks, emphasis or link targets. */
const plain = (source: string) =>
	source
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/[`*]/g, '')
		.trim();

/** Render one page's Markdown to HTML, collecting its second- and third-level headings. */
export function render(markdown: string): Rendered {
	const headings: Heading[] = [];
	const ids = new Set<string>();

	function uniqueId(source: string, text: string): string {
		// A heading that is just an API name in code (`beforeQuit`) keeps its
		// spelling, so links to it read like the name. Any other heading becomes a
		// lowercase slug.
		const base = /^`[\w$]+`$/.test(source.trim())
			? text
			: text
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '');
		let id = base;
		for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
		ids.add(id);
		return id;
	}

	const marked = new Marked({
		gfm: true,
		renderer: {
			heading({ tokens, depth, text: source }) {
				const html = this.parser.parseInline(tokens);
				if (depth === 1) {
					throw new Error(`"# ${source}": a page's title comes from its front matter.`);
				}
				const text = plain(source);
				const id = uniqueId(source, text);
				if (depth === 2 || depth === 3) headings.push({ depth, id, text });
				return (
					`<h${depth} id="${id}">${html}` +
					`<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`
				);
			},

			// ```ts title="fsn.ts" puts a file name above the code.
			code({ text, lang = '' }) {
				const language = lang.split(/\s+/)[0] || 'text';
				const title = /title="([^"]+)"/.exec(lang)?.[1];
				const code = highlighter.codeToHtml(text, {
					lang: language,
					themes: THEMES,
					defaultColor: false
				});
				return (
					`<figure class="code">` +
					(title ? `<figcaption>${escape(title)}</figcaption>` : '') +
					code +
					`<button type="button" class="copy" data-copy>Copy</button>` +
					`</figure>\n`
				);
			},

			// GitHub's alert syntax: a quote that starts with [!NOTE], [!TIP] or [!WARNING].
			blockquote({ tokens }) {
				const body = this.parser.parse(tokens);
				const match = /^<p>\[!([A-Z]+)\]\s*/.exec(body);
				if (!match) return `<blockquote>\n${body}</blockquote>\n`;
				const label = CALLOUTS[match[1]];
				if (!label) throw new Error(`Unknown callout [!${match[1]}].`);
				return (
					`<aside class="callout callout-${match[1].toLowerCase()}">` +
					`<p class="callout-title">${label}</p>\n` +
					`<p>${body.slice(match[0].length)}</aside>\n`
				);
			},

			// Wide tables scroll inside their own box instead of widening the page.
			table(token) {
				const cell = (c: (typeof token.header)[number]) => this.tablecell(c);
				const header = this.tablerow({ text: token.header.map(cell).join('') });
				const rows = token.rows.map((row) => this.tablerow({ text: row.map(cell).join('') }));
				return (
					`<div class="table-wrap"><table>\n<thead>\n${header}</thead>\n` +
					`<tbody>\n${rows.join('')}</tbody>\n</table></div>\n`
				);
			}
		}
	});

	const html = marked.parse(markdown, { async: false });
	return { html, headings };
}
