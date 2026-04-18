import { jarvisPost } from '../lib/jarvis-client.js';

export async function handleDream() {
  const result = await jarvisPost<{ data?: { status?: string }; status?: string }>('/dream', {});

  if (!result.ok) {
    return { content: [{ type: 'text' as const, text: result.error }] };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: 'Dream queued. Deep consolidation runs asynchronously — run /recall in a few minutes to check results.',
      },
    ],
  };
}
