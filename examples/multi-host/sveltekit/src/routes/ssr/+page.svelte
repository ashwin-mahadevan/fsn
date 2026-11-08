<script>
  let { data } = $props();
</script>

<h1>Server-Side Rendering</h1>
<p>Rendered at: <strong>{data.timestamp}</strong></p>
<p>Random (changes on every request): <strong>{data.random}</strong></p>
<p><a href="/">← Back</a></p>
