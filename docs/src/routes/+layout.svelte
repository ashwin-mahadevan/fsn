<script lang="ts">
	import type { LayoutProps } from './$types';
	import { resolve } from '$app/paths';
	import './layout.css';

	let { children }: LayoutProps = $props();
</script>

<header class="mx-auto flex max-w-3xl items-center gap-6 px-4 pt-6">
	<a href={resolve('/')} class="font-bold no-underline">FSN</a>
	<nav class="flex gap-4 text-sm">
		<a href={resolve('/cli')}>CLI</a>
	</nav>
</header>

<main class="mx-auto prose max-w-3xl px-4 py-12">
	{@render children()}
</main>
