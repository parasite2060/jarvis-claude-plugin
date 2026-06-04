import { describe, it, expect } from 'vitest';
import { dreamSchema } from '../schemas.js';

describe('dream schema', () => {
  it('accepts an empty object', () => {
    const result = dreamSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('strips unknown fields and still parses', () => {
    const result = dreamSchema.safeParse({ type: 'deep' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid ISO YYYY-MM-DD source_date', () => {
    const result = dreamSchema.safeParse({ source_date: '2026-04-20' });
    expect(result.success).toBe(true);
  });

  it('rejects source_date that is not a date string', () => {
    const result = dreamSchema.safeParse({ source_date: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('rejects source_date without zero-padding', () => {
    const result = dreamSchema.safeParse({ source_date: '2026-4-20' });
    expect(result.success).toBe(false);
  });
});
