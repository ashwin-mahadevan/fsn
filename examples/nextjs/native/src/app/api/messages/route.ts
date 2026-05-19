import { NextResponse } from 'next/server';
import { getMessages, addMessage } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ messages: getMessages() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }
  try {
    const message = addMessage(body.text);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
