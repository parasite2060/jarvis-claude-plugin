import { z } from 'zod';

export const memorySearchSchema = z.object({
  query: z.string().describe('Search query for past memories'),
});

export const memoryAddSchema = z.object({
  content: z.string().describe('Memory content to store'),
  context: z.string().optional().describe('Additional context about when/why this memory matters'),
});
