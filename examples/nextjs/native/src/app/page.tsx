import { Suspense } from 'react';
import { getMessages } from '@/lib/store';
import { postMessage } from './actions';

export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' }}>
      <h1>FSN Next.js example</h1>
      <p>This page is a React Server Component, rendered inside Electron via FSN.</p>

      <section>
        <h2>Post a message</h2>
        <p>Submits a <code>&lt;form action={'{'}postMessage{'}'}&gt;</code> server action.</p>
        <form action={postMessage} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            name="text"
            type="text"
            required
            placeholder="Say something…"
            style={{ flex: 1, padding: '0.5rem' }}
          />
          <button type="submit" style={{ padding: '0.5rem 1rem' }}>Post</button>
        </form>
      </section>

      <section>
        <h2>Messages (server-rendered)</h2>
        <Suspense fallback={<p>Loading…</p>}>
          <Messages />
        </Suspense>
      </section>

      <section>
        <h2>Route handler</h2>
        <p>
          <a href="/api/messages">GET /api/messages</a> — returns the same data as JSON.
        </p>
      </section>

      <section>
        <h2>Static page</h2>
        <p>
          <a href="/about">/about</a> — a fully prerendered server component (no dynamic data),
          served as static HTML straight out of the next build output.
        </p>
      </section>
    </main>
  );
}

async function Messages() {
  const messages = getMessages();
  if (messages.length === 0) return <p>No messages yet.</p>;
  return (
    <ul>
      {messages.map((m) => (
        <li key={m.id}>
          <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString()}</time>
          {' — '}
          {m.text}
        </li>
      ))}
    </ul>
  );
}
