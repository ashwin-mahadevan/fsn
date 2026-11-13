// A dynamic route: "hello" is prerendered, any other slug renders on demand.
export function generateStaticParams() {
  return [{ slug: "hello" }];
}

export default async function Post({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main style={{ padding: 32 }}>
      <h1 id="slug">Post: {slug}</h1>
    </main>
  );
}
