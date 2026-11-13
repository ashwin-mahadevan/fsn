<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { sections } from '#lib/nav.ts';
	import type { LayoutProps } from './$types';
	import './layout.css';

	let { children }: LayoutProps = $props();

	// On small screens the sidebar is a drawer, opened from the header.
	let open = $state(false);
	afterNavigate(() => {
		open = false;
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') open = false;
	}}
/>

<a
	href="#content"
	class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-indigo-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
>
	Skip to content
</a>

<header
	class="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85"
>
	<div class="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
		<button
			type="button"
			class="-ml-2 rounded-md p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
			aria-label={open ? 'Close navigation' : 'Open navigation'}
			aria-expanded={open}
			aria-controls="sidebar"
			onclick={() => (open = !open)}
		>
			<svg
				viewBox="0 0 20 20"
				class="size-5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				aria-hidden="true"
			>
				{#if open}
					<path d="M5 5l10 10M15 5L5 15" />
				{:else}
					<path d="M3 5.5h14M3 10h14M3 14.5h14" />
				{/if}
			</svg>
		</button>

		<a href={resolve('')} class="flex items-baseline gap-2.5">
			<span class="text-lg font-bold tracking-tight">FSN</span>
			<span class="hidden text-sm text-zinc-500 sm:inline dark:text-zinc-400">
				Full-Stack Native
			</span>
		</a>

		<nav class="ml-auto flex items-center gap-5 text-sm font-medium" aria-label="Elsewhere">
			<a
				href="https://www.npmjs.com/package/@fsn.dev/cli"
				rel="external"
				class="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
			>
				npm
			</a>
			<a
				href="https://github.com/ashwin-mahadevan/fsn"
				rel="external"
				class="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
			>
				GitHub
			</a>
		</nav>
	</div>
</header>

<div class="mx-auto flex max-w-7xl px-4 sm:px-6 lg:px-8">
	{#if open}
		<button
			type="button"
			class="fixed inset-0 top-14 z-10 bg-zinc-950/30 backdrop-blur-sm lg:hidden"
			aria-label="Close navigation"
			tabindex="-1"
			onclick={() => (open = false)}
		></button>
	{/if}

	<nav
		id="sidebar"
		aria-label="Documentation"
		class={[
			'fixed top-14 bottom-0 left-0 z-20 w-72 overflow-y-auto border-r border-zinc-200 bg-white px-6 py-8 transition-transform dark:border-zinc-800 dark:bg-zinc-950',
			'lg:sticky lg:z-0 lg:h-[calc(100vh-3.5rem)] lg:w-60 lg:shrink-0 lg:translate-x-0 lg:border-r-0 lg:bg-transparent lg:py-10 lg:pr-6 lg:pl-0 dark:lg:bg-transparent',
			open ? 'translate-x-0' : 'max-lg:invisible max-lg:-translate-x-full'
		]}
	>
		{#each sections as section (section.title)}
			<p class="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</p>
			<ul class="mb-8 space-y-0.5 border-l border-zinc-200 dark:border-zinc-800">
				{#each section.pages as item (item.path)}
					{@const active = page.url.pathname === item.path}
					<li>
						<a
							href={resolve(item.path.slice(1))}
							aria-current={active ? 'page' : undefined}
							class={[
								'-ml-px block border-l py-1 pl-4 text-sm transition-colors',
								active
									? 'border-indigo-600 font-medium text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
									: 'border-transparent text-zinc-600 hover:border-zinc-400 hover:text-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-white'
							]}
						>
							{item.title}
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>

	<main id="content" class="min-w-0 flex-1 py-10 lg:pl-10">
		{@render children()}

		<footer
			class="mt-16 border-t border-zinc-200 pt-6 pb-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
		>
			FSN is open source, under the
			<a
				href="https://github.com/ashwin-mahadevan/fsn/blob/master/LICENSE"
				rel="external"
				class="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
				>MIT license</a
			>.
		</footer>
	</main>
</div>
