import { describe, it, expect } from 'vitest';
import { memorySearchSchema, memoryAddSchema, dreamSchema } from '../schemas.js';

describe('memory_search schema', () => {
  it('accepts a valid query string', () => {
    const result = memorySearchSchema.safeParse({ query: 'TypeScript conventions' });
    expect(result.success).toBe(true);
  });

  it('rejects missing query', () => {
    const result = memorySearchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string query', () => {
    const result = memorySearchSchema.safeParse({ query: 42 });
    expect(result.success).toBe(false);
  });

  it('rejects null query', () => {
    const result = memorySearchSchema.safeParse({ query: null });
    expect(result.success).toBe(false);
  });
});

describe('memory_add schema', () => {
  it('accepts content with optional context', () => {
    const result = memoryAddSchema.safeParse({
      content: 'Use httpx.AsyncClient for all HTTP calls',
      context: 'Project standard — async-first Python codebase',
    });
    expect(result.success).toBe(true);
  });

  it('accepts content without context', () => {
    const result = memoryAddSchema.safeParse({
      content: 'Use httpx.AsyncClient for all HTTP calls',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing content', () => {
    const result = memoryAddSchema.safeParse({ context: 'some context' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string content', () => {
    const result = memoryAddSchema.safeParse({ content: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects non-string context when provided', () => {
    const result = memoryAddSchema.safeParse({ content: 'valid', context: 99 });
    expect(result.success).toBe(false);
  });

  it('accepts explicit undefined context', () => {
    const result = memoryAddSchema.safeParse({ content: 'valid', context: undefined });
    expect(result.success).toBe(true);
  });
});

describe('dream schema', () => {
  it('accepts an empty object', () => {
    const result = dreamSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('strips unknown fields and still parses', () => {
    const result = dreamSchema.safeParse({ type: 'deep' });
    expect(result.success).toBe(true);
  });
});
