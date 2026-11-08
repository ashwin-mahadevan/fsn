<script>
  let chunks = $state([]);
  let streaming = $state(false);

  async function start() {
    chunks = [];
    streaming = true;
    const res = await fetch('/api/stream');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks = [...chunks, dec.decode(value)];
    }
    streaming = false;
  }
</script>

<h1>SSE Streaming</h1>
<button onclick={start} disabled={streaming}>
  {streaming ? 'Streaming…' : 'Start stream'}
</button>
<ol>
  {#each chunks as c}
    <li><code>{c.trim()}</code></li>
  {/each}
</ol>
<p><a href="/">← Back</a></p>
