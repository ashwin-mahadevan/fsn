export const GET = () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 1; i <= 10; i++) {
        await new Promise((r) => setTimeout(r, 300));
        controller.enqueue(encoder.encode(`data: chunk ${i} — ${new Date().toISOString()}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
