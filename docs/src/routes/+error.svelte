<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Page not found' : 'Something went wrong'} · FSN</title>
</svelte:head>

<div class="prose max-w-none prose-zinc dark:prose-invert">
	{#if page.status === 404}
		<h1>Page not found</h1>
		<p>
			There's no page at <code>{page.url.pathname}</code>. It may have moved: try the sidebar, or
			start from the <a href={resolve('')}>introduction</a>.
		</p>
	{:else}
		<h1>Something went wrong</h1>
		<p>{page.status}: {page.error?.message}</p>
	{/if}
</div>
