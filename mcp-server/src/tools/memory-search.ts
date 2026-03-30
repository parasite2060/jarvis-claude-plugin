import { jarvisPost } from '../lib/jarvis-client.js';
import type { MemorySearchResponse, MemorySearchResult } from '../types.js';

function formatResult(result: MemorySearchResult, index: number): string {
  let line = `${index + 1}. [Relevance: ${result.relevance.toFixed(2)}] ${result.content}`;
  if (result.source) {
    line += `\n   Source: ${result.source}`;
  }
  return line;
}

export async function handleMemorySearch(query: string) {
  const result = await jarvisPost<MemorySearchResponse>('/memory/search', { query, method: 'rag' });

  if (!result.ok) {
    return { content: [{ type: 'text' as const, text: result.error }] };
  }

  const results = result.data.data?.results;
  if (!results || results.length === 0) {
    return { content: [{ type: 'text' as const, text: 'No memories found matching your query.' }] };
  }

  const formatted = results.map(formatResult).join('\n\n');
  const text = `Found ${results.length} memories matching "${query}":\n\n${formatted}`;
  return { content: [{ type: 'text' as const, text }] };
}
