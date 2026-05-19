'use server';

import { revalidatePath } from 'next/cache';
import { addMessage } from '@/lib/store';

export async function postMessage(formData: FormData) {
  const text = String(formData.get('text') ?? '');
  if (!text.trim()) return;
  addMessage(text);
  revalidatePath('/');
}
