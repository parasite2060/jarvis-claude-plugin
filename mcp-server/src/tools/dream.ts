import { jarvisPost } from '../lib/jarvis-client.js';

interface DreamArgs {
  source_date?: string;
}

export async function handleDream(args: DreamArgs = {}) {
  const body = args.source_date ? { source_date: args.source_date } : {};
  const result = await jarvisPost<{ data?: { status?: string }; status?: string }>('/dream', body);

  if (!result.ok) {
    return { content: [{ type: 'text' as const, text: result.error }] };
  }

  const dateNote = args.source_date ? ` for ${args.source_date}` : '';
  return {
    content: [
      {
        type: 'text' as const,
        text: `Dream queued${dateNote}. Deep consolidation runs asynchronously — run /recall in a few minutes to check results.`,
      },
    ],
  };
}
