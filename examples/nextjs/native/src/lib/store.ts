// In-memory message store. State lives in the Electron main-process
// module graph for the life of the app — restarts wipe it. Real apps would
// swap this for SQLite, a file, etc.

export type Message = { id: number; text: string; createdAt: string };

const messages: Message[] = [
  { id: 1, text: 'Welcome to your FSN app.', createdAt: new Date().toISOString() },
];
let nextId = messages.length + 1;

export function getMessages(): Message[] {
  return messages.slice().reverse();
}

export function addMessage(text: string): Message {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('text required');
  const message: Message = {
    id: nextId++,
    text: trimmed,
    createdAt: new Date().toISOString(),
  };
  messages.push(message);
  return message;
}
