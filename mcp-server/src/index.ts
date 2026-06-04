#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dreamSchema } from './schemas.js';
import { handleDream } from './tools/dream.js';

const server = new McpServer({
  name: 'jarvis-memory',
  version: '0.1.0',
});

server.tool(
  'dream',
  'Trigger a manual deep dream (memory consolidation) on the Jarvis server. Accepts an optional source_date (YYYY-MM-DD) to backfill a past day. Returns immediately once queued. The dream runs asynchronously in the background.',
  dreamSchema.shape,
  async (args) => handleDream(args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
