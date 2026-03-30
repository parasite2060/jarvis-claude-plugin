import { jarvisPost } from '../lib/jarvis-client.js';
import type { MemoryAddResponse } from '../types.js';

export async function handleMemoryAdd(content: string, context?: string) {
  const result = await jarvisPost<MemoryAddResponse>('/memory/add', { content, metadata: { context } });

  if (!result.ok) {
    return { content: [{ type: 'text' as const, text: result.error }] };
  }

  const memoryId = result.data.data?.memoryId ?? 'unknown';
  return { content: [{ type: 'text' as const, text: `Memory stored successfully (ID: ${memoryId})` }] };
}
