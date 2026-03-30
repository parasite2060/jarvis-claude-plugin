import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { jarvisPost } from './lib/jarvis-client.js';
import { memorySearchSchema, memoryAddSchema } from './schemas.js';

const server = new McpServer({
  name: 'jarvis-memory',
  version: '0.1.0',
});

server.tool(
  'memory_search',
  'Search past memories semantically. Returns relevant decisions, preferences, patterns, and facts.',
  memorySearchSchema.shape,
  async ({ query }) => {
    try {
      const data = await jarvisPost<unknown>('/memory/search', { query, method: 'rag' });
      if (data === null) {
        return { content: [{ type: 'text' as const, text: 'Jarvis server unavailable or returned an error.' }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Error searching memories: ${message}` }] };
    }
  },
);

server.tool(
  'memory_add',
  'Store a new memory. Use for decisions (with reasoning), preferences, patterns, corrections, or facts.',
  memoryAddSchema.shape,
  async ({ content, context }) => {
    try {
      const data = await jarvisPost<unknown>('/memory/add', { content, metadata: { context } });
      if (data === null) {
        return { content: [{ type: 'text' as const, text: 'Jarvis server unavailable or returned an error.' }] };
      }
      return { content: [{ type: 'text' as const, text: `Memory stored: ${JSON.stringify(data)}` }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Error storing memory: ${message}` }] };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
