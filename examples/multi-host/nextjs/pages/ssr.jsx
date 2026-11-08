export async function getServerSideProps() {
  return {
    props: {
      timestamp: new Date().toISOString(),
      random: Math.floor(Math.random() * 100_000),
    },
  };
}

export default function SSR({ timestamp, random }) {
  return (
    <div>
      <h1>Server-Side Rendering</h1>
      <p>Rendered at: <strong>{timestamp}</strong></p>
      <p>Random (changes on every request): <strong>{random}</strong></p>
      <p><a href="/">← Back</a></p>
    </div>
  );
}
