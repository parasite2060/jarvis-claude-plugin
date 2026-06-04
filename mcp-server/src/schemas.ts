import { z } from 'zod';

export const dreamSchema = z.object({
  source_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'source_date must be YYYY-MM-DD')
    .optional()
    .describe(
      'Optional ISO date (YYYY-MM-DD) to backfill a deep dream for a past day. Defaults to today.',
    ),
});
