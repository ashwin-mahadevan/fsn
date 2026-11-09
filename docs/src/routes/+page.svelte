<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>FSN Docs</title>
	<meta name="description" content="Documentation for FSN: Full-Stack Native." />
</svelte:head>

<h1>FSN</h1>
<p>Full-Stack Native. Use any full-stack framework to create a native app.</p>
<p>
	FSN packages a SvelteKit or Next.js app as an Electron application. Requests from the window are
	handed to your server in-process, so there is no TCP port and no static export.
</p>
<p>Start with the <a href={resolve('/cli')}>CLI guide</a>.</p>
