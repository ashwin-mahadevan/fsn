<svelte:head>
	<title>CLI · FSN Docs</title>
	<meta name="description" content="How to use the fsn command-line tool." />
</svelte:head>

<h1>CLI</h1>
<p>
	The <code>fsn</code> CLI is published as <code>@fsn.dev/cli</code>. It requires Node 22 or newer
	and uses <a href="https://pnpm.io">pnpm</a> to install and build your hosts.
</p>

<h2>Quick start</h2>
<pre><code
		>npx @fsn.dev/cli init --project my-app --framework sveltekit
cd my-app
pnpm install
pnpm build</code
	></pre>
<p>
	The packaged app is written to <code>dist/</code> for your current platform and architecture.
</p>

<h2>Commands</h2>

<h3><code>fsn init</code></h3>
<pre><code>fsn init [--project &lt;dir&gt;] [--framework &lt;sveltekit|nextjs&gt;]</code></pre>
<p>Scaffolds a new FSN project.</p>
<ul>
	<li>
		<code>--project</code>: directory to create. Defaults to <code>.</code>. It must be missing or
		empty.
	</li>
	<li>
		<code>--framework</code>: <code>sveltekit</code> or <code>nextjs</code>. Defaults to
		<code>nextjs</code>.
	</li>
</ul>
<p>The generated project is a pnpm workspace:</p>
<pre><code
		>my-app/
├── fsn.config.js        # declares your hosts
├── package.json         # "build": "fsn build"
├── pnpm-workspace.yaml
└── native/              # the SvelteKit or Next.js app</code
	></pre>
<p>
	For SvelteKit, <code>init</code> replaces <code>@sveltejs/adapter-auto</code> with
	<code>@fsn.dev/adapter-sveltekit</code>.
</p>

<h3><code>fsn build</code></h3>
<pre><code>fsn build</code></pre>
<p>Run from the project root. It:</p>
<ol>
	<li>Builds every host listed in <code>fsn.config.js</code>.</li>
	<li>Stages each host's production dependencies and build output in a temporary directory.</li>
	<li>Packages the result with Electron Packager.</li>
	<li>Copies the app to <code>dist/</code>, replacing any previous contents.</li>
</ol>

<h3>Help</h3>
<p>Run <code>fsn --help</code> (or <code>-h</code>) to print usage.</p>

<h2>Configuration</h2>
<p>
	<code>fsn.config.js</code> lives in the project root and default-exports a config object. Type it with
	JSDoc:
</p>
<pre><code
		>/** @type &#123;import('@fsn.dev/cli').Config&#125; */
export default &#123;
  hosts: &#123;
    native: './native',
  &#125;,
&#125;;</code
	></pre>
<p>
	<code>hosts</code> maps a host name to the path of a SvelteKit or Next.js package, relative to the
	config file. The path must contain a <code>package.json</code>. FSN detects the framework from
	<code>@sveltejs/kit</code> or <code>next</code> in its dependencies.
</p>
<p>
	Each host is served to the app at <code>http://&lt;host-name&gt;.localhost/</code>. You can list
	several hosts, for example one SvelteKit and one Next.js package:
</p>
<pre><code
		>hosts: &#123;
  sveltekit: './sveltekit',
  nextjs: './nextjs',
&#125;,</code
	></pre>
