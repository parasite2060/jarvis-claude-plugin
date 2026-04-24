import { z } from 'zod';

export const memorySearchSchema = z.object({
  query: z.string().describe('Search query for past memories'),
});

export const memoryAddSchema = z.object({
  content: z.string().describe('Memory content to store'),
  context: z.string().optional().describe('Additional context about when/why this memory matters'),
});

export const dreamSchema = z.object({
  source_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'source_date must be YYYY-MM-DD')
    .optional()
    .describe(
      'Optional ISO date (YYYY-MM-DD) to backfill a deep dream for a past day. Defaults to today.',
    ),
});
