// A route handler that runs on every request, in the app's main process.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json({
    now: new Date().toISOString(),
    url: request.url,
    pid: process.pid,
  });
}

export async function POST(request: Request) {
  return Response.json({ echo: await request.text() });
}
