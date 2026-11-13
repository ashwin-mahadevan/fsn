<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { pages } from '#lib/nav.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const index = $derived(pages.findIndex(({ path }) => path === page.url.pathname));
	const previous = $derived(index > 0 ? pages[index - 1] : undefined);
	const next = $derived(index >= 0 ? pages[index + 1] : undefined);

	// The heading the reader has most recently scrolled to, for the table of contents.
	let current = $state<string>();

	/** Highlight the section being read, and make the code blocks' Copy buttons work. */
	function interactive(article: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) current = entry.target.id;
				}
			},
			// A heading counts once it's in the top third of the window, below the header.
			{ rootMargin: '-64px 0px -66% 0px' }
		);
		for (const heading of article.querySelectorAll('h2[id], h3[id]')) observer.observe(heading);

		function copy(event: MouseEvent) {
			if (!(event.target instanceof HTMLElement)) return;
			const button = event.target.closest('[data-copy]');
			const code = button?.parentElement?.querySelector('pre')?.textContent;
			if (!button || !code) return;
			navigator.clipboard.writeText(code).then(() => {
				button.textContent = 'Copied';
				setTimeout(() => (button.textContent = 'Copy'), 1500);
			});
		}
		article.addEventListener('click', copy);

		return () => {
			observer.disconnect();
			article.removeEventListener('click', copy);
			current = undefined;
		};
	}
</script>

<svelte:head>
	<title>{page.url.pathname === '/' ? 'FSN: Full-Stack Native' : `${data.title} · FSN`}</title>
	<meta name="description" content={data.description} />
</svelte:head>

<div class="flex gap-12">
	<div class="min-w-0 flex-1">
		<!-- Keyed so that each page gets a fresh article, and with it fresh observers. -->
		{#key data.html}
			<article class="prose max-w-none prose-zinc dark:prose-invert" {@attach interactive}>
				<h1>{data.title}</h1>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own Markdown, rendered at build time -->
				{@html data.html}
			</article>
		{/key}

		<nav
			class="mt-16 grid gap-4 border-t border-zinc-200 pt-8 sm:grid-cols-2 dark:border-zinc-800"
			aria-label="Previous and next page"
		>
			{#if previous}
				<a href={resolve(previous.path.slice(1))} class="pager">
					<span class="pager-label">Previous</span>
					<span class="pager-title">{previous.title}</span>
				</a>
			{/if}
			{#if next}
				<a href={resolve(next.path.slice(1))} class="pager text-right sm:col-start-2">
					<span class="pager-label">Next</span>
					<span class="pager-title">{next.title}</span>
				</a>
			{/if}
		</nav>
	</div>

	{#if data.headings.length > 0}
		<nav
			class="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-56 shrink-0 self-start overflow-y-auto text-sm xl:block"
			aria-label="On this page"
		>
			<p class="mb-3 font-semibold text-zinc-900 dark:text-zinc-100">On this page</p>
			<ul class="space-y-2 border-l border-zinc-200 dark:border-zinc-800">
				{#each data.headings as heading (heading.id)}
					<li>
						<a
							href={`#${heading.id}`}
							class={[
								'-ml-px block border-l py-0.5 transition-colors',
								heading.depth === 3 ? 'pl-7' : 'pl-4',
								heading.id === current
									? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
									: 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
							]}
						>
							{heading.text}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>
