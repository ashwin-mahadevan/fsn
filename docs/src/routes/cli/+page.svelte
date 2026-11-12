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

<h2>Running the CLI</h2>
<p>There are two ways to run it.</p>

<h3>Without installing</h3>
<p>
	Use this outside a project, such as for <code>fsn init</code>. The package name is
	<code>@fsn.dev/cli</code>, and everything after it is passed to <code>fsn</code>:
</p>
<pre><code
		>npx @fsn.dev/cli --help
pnpm dlx @fsn.dev/cli --help</code
	></pre>

<h3>Inside a project</h3>
<p>
	Projects created by <code>fsn init</code> have <code>@fsn.dev/cli</code> as a dev dependency, so
	the
	<code>fsn</code> command is available directly:
</p>
<pre><code
		>pnpm exec fsn --help
npx fsn --help</code
	></pre>
<p>
	In a project's <code>package.json</code> scripts, <code>fsn</code> works as is. The generated
	project already has <code>"build": "fsn build"</code>, so <code>pnpm build</code> runs
	<code>fsn build</code>. If you add the CLI to an existing project, install it with
	<code>pnpm add -D @fsn.dev/cli</code>.
</p>

<h2>Commands</h2>
<p>
	Examples below are written as <code>fsn &lt;command&gt;</code>. Use either form above, for example
	<code>npx @fsn.dev/cli init</code> or <code>pnpm exec fsn build</code>.
</p>

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
	<li>Bundles <code>fsn.ts</code>, if the project has one (see <a href="#hooks">Hooks</a>).</li>
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
<p>
	<code>icon</code> (optional) is the path of the app's icon, relative to the config file, passed to
	<a href="https://github.com/electron/packager">@electron/packager</a>. Give it without an
	extension and the packager picks the platform's own file next to it: <code>.icon</code> (an Icon
	Composer document) or <code>.icns</code> on macOS, <code>.ico</code> on Windows. With
	<code>icon: './icon'</code>, a macOS build uses <code>icon.icon</code> (or <code>icon.icns</code>)
	and a Windows build uses <code>icon.ico</code>. Linux apps get no embedded icon; desktop
	environments take one from an icon theme instead.
</p>

<h2 id="hooks">Hooks</h2>
<p>
	To run code in the app's main process, add an <code>fsn.ts</code> (or <code>fsn.js</code>) next to
	<code>fsn.config.js</code>. Each of its named exports is a hook that FSN calls at one point in the
	app's life:
</p>
<pre><code
		>import &#123; app, Menu &#125; from 'electron';
import type &#123; Hooks &#125; from '@fsn.dev/cli';

// Runs before the first window opens.
export const ready: Hooks['ready'] = () =&gt; &#123;
  Menu.setApplicationMenu(Menu.buildFromTemplate([&#123; role: 'appMenu' &#125;, &#123; role: 'editMenu' &#125;]));
&#125;;

// Quit when the last window closes, on macOS too.
export const windowAllClosed: Hooks['windowAllClosed'] = () =&gt; &#123;
  app.quit();
&#125;;</code
	></pre>
<p>
	Except for <code>ready</code>, a hook is a listener for the event of the same name on Electron's
	<a href="https://www.electronjs.org/docs/latest/api/app#events"><code>app</code></a>, and is
	called with that event's arguments: <code>beforeQuit</code> is the listener for
	<code>before-quit</code>.
</p>
<table>
	<thead>
		<tr><th>Export</th><th>Called when</th></tr>
	</thead>
	<tbody>
		<tr>
			<td><code>ready()</code></td>
			<td>
				The app is ready and its hosts are being served, before FSN opens the first windows. If it
				returns a promise, FSN waits for it.
			</td>
		</tr>
		<tr>
			<td><code>activate(event, hasVisibleWindows)</code></td>
			<td>
				macOS: the app is activated, for example from the Dock. Replaces the default, which reopens
				the hosts' windows when none are open. Not called before the first windows have opened.
			</td>
		</tr>
		<tr>
			<td><code>windowAllClosed()</code></td>
			<td> The last window closes. Replaces the default, which quits the app except on macOS. </td>
		</tr>
		<tr>
			<td><code>beforeQuit(event)</code></td>
			<td>
				The app is about to close its windows to quit. <code>event.preventDefault()</code> cancels.
			</td>
		</tr>
		<tr>
			<td><code>willQuit(event)</code></td>
			<td>
				Every window has closed and the app will quit. <code>event.preventDefault()</code> cancels.
			</td>
		</tr>
		<tr>
			<td><code>quit(event, exitCode)</code></td>
			<td>The app is quitting.</td>
		</tr>
		<tr>
			<td><code>openUrl(event, url)</code></td>
			<td>macOS: the app is asked to open a URL with one of its schemes.</td>
		</tr>
		<tr>
			<td><code>openFile(event, path)</code></td>
			<td>macOS: the app is asked to open a file.</td>
		</tr>
		<tr>
			<td><code>secondInstance(event, argv, workingDirectory, additionalData)</code></td>
			<td>A second instance is launched while this one holds the single-instance lock.</td>
		</tr>
		<tr>
			<td><code>browserWindowCreated(event, window)</code></td>
			<td>A window is created.</td>
		</tr>
		<tr>
			<td><code>webContentsCreated(event, webContents)</code></td>
			<td>A window's contents are created.</td>
		</tr>
	</tbody>
</table>
<p>
	<code>fsn build</code> fails if <code>fsn.ts</code> exports anything else, so a misspelt hook is caught
	there.
</p>

<h3>What <code>fsn.ts</code> can do</h3>
<ul>
	<li>
		<strong>Use Electron.</strong> Import from <code>electron</code> as in any main process. For its
		types, and those of <code>Hooks</code>, add it to the project with
		<code>pnpm add -D electron</code>. The app itself is built with the Electron version the CLI
		pins.
	</li>
	<li>
		<strong>Set up before the app is ready.</strong> The file is loaded before Electron's
		<code>ready</code> event, so code at its top level can make calls that have to come first, such
		as <code>app.requestSingleInstanceLock()</code>.
	</li>
	<li>
		<strong>Open windows.</strong> Every window in the app can load a host: from
		<code>ready</code> on,
		<code>new BrowserWindow().loadURL('http://&lt;host-name&gt;.localhost/')</code> works.
	</li>
	<li>
		<strong>Call a host.</strong> From <code>ready</code> on,
		<code>fetch('http://&lt;host-name&gt;.localhost/…')</code> reaches the host in-process, the same
		way its windows do. Use this, not an import, to reach a host's server code:
		<code>fsn.ts</code> is bundled apart from the hosts, so an import gets a separate copy of the module,
		with its own state.
	</li>
	<li>
		<strong>Import other files and packages.</strong> They are bundled in with it. Packages with native
		addons can't be bundled, so keep those in a host.
	</li>
</ul>
