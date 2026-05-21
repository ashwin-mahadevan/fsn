import { useState } from 'react';

export default function Stream() {
  const [chunks, setChunks] = useState([]);
  const [streaming, setStreaming] = useState(false);

  async function start() {
    setChunks([]);
    setStreaming(true);
    const res = await fetch('/api/stream');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      setChunks((c) => [...c, dec.decode(value)]);
    }
    setStreaming(false);
  }

  return (
    <div>
      <h1>SSE Streaming</h1>
      <button onClick={start} disabled={streaming}>
        {streaming ? 'Streaming…' : 'Start stream'}
      </button>
      <ol>
        {chunks.map((c, i) => (
          <li key={i}><code>{c.trim()}</code></li>
        ))}
      </ol>
      <p><a href="/">← Back</a></p>
    </div>
  );
}
