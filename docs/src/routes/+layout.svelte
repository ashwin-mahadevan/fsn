<script lang="ts">
	import type { LayoutProps } from './$types';
	import './layout.css';

	let { children }: LayoutProps = $props();
</script>

<main class="prose mx-auto max-w-3xl px-4 py-12">
	{@render children()}
</main>
