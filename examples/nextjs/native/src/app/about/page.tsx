export default function About() {
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' }}>
      <h1>About this app</h1>
      <p>
        This page has no dynamic data and uses no dynamic functions, so next
        prerendered it at build time. FSN's protocol.handle serves the static
        HTML straight from the build output — no server work per request.
      </p>
      <p><a href="/">← Back to the dynamic home page</a></p>
    </main>
  );
}
