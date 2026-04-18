#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { memorySearchSchema, memoryAddSchema, dreamSchema } from './schemas.js';
import { handleMemorySearch } from './tools/memory-search.js';
import { handleMemoryAdd } from './tools/memory-add.js';
import { handleDream } from './tools/dream.js';

const server = new McpServer({
  name: 'jarvis-memory',
  version: '0.1.0',
});

server.tool(
  'memory_search',
  'Search past memories semantically. Returns relevant decisions, preferences, patterns, and facts.',
  memorySearchSchema.shape,
  async ({ query }) => handleMemorySearch(query),
);

server.tool(
  'memory_add',
  'Store a new memory. Use for decisions (with reasoning), preferences, patterns, corrections, or facts.',
  memoryAddSchema.shape,
  async ({ content, context }) => handleMemoryAdd(content, context),
);

server.tool(
  'dream',
  'Trigger a manual deep dream (memory consolidation) on the Jarvis server. Returns immediately once queued. The dream runs asynchronously in the background.',
  dreamSchema.shape,
  async () => handleDream(),
);

const transport = new StdioServerTransport();
await server.connect(transport);
