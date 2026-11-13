import { headers } from "next/headers";
import Link from "next/link";

// Rendered on every request, in the app's main process.
export const dynamic = "force-dynamic";

export default async function Ssr() {
  const host = (await headers()).get("host");
  return (
    <main style={{ padding: 32 }}>
      <h1>Server-rendered</h1>
      <p id="rendered-at">Rendered at {new Date().toISOString()}</p>
      <p id="host">Host: {host}</p>
      <p id="pid">Process: {process.pid}</p>
      <p>
        <Link href="/">Home</Link> · <Link href="/isr">ISR</Link> ·{" "}
        <Link href="/posts/hello">A post</Link>
      </p>
    </main>
  );
}
