// Prerendered at build time, then regenerated at most every 5 seconds.
export const revalidate = 5;

export default function Isr() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Incremental static regeneration</h1>
      <p id="generated-at">Generated at {new Date().toISOString()}</p>
    </main>
  );
}
