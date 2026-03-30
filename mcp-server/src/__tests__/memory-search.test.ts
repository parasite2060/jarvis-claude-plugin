import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JarvisResult } from '../lib/jarvis-client.js';

vi.mock('../lib/jarvis-client.js', () => ({
  jarvisPost: vi.fn(),
}));

const { jarvisPost } = await import('../lib/jarvis-client.js');
const { handleMemorySearch } = await import('../tools/memory-search.js');
const mockJarvisPost = vi.mocked(jarvisPost);

beforeEach(() => {
  mockJarvisPost.mockReset();
});

describe('handleMemorySearch', () => {
  it('formats successful results with relevance and source', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: {
        data: {
          results: [
            { content: 'Use async/await everywhere', relevance: 0.95, source: 'decisions/async.md' },
            { content: 'Prefer httpx over requests', relevance: 0.82, source: 'MEMORY.md' },
          ],
          query: 'async patterns',
          method: 'rag',
        },
        status: 'ok',
      },
    } as JarvisResult<unknown>);

    const result = await handleMemorySearch('async patterns');
    const text = result.content[0].text;

    expect(text).toContain('Found 2 memories matching "async patterns"');
    expect(text).toContain('[Relevance: 0.95]');
    expect(text).toContain('Use async/await everywhere');
    expect(text).toContain('Source: decisions/async.md');
    expect(text).toContain('[Relevance: 0.82]');
    expect(text).toContain('Source: MEMORY.md');
  });

  it('formats results without source when source is absent', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: {
        data: {
          results: [{ content: 'A memory without source', relevance: 0.75 }],
          query: 'test',
          method: 'rag',
        },
        status: 'ok',
      },
    } as JarvisResult<unknown>);

    const result = await handleMemorySearch('test');
    const text = result.content[0].text;

    expect(text).toContain('[Relevance: 0.75]');
    expect(text).toContain('A memory without source');
    expect(text).not.toContain('Source:');
  });

  it('returns "No memories found" for empty results', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { results: [], query: 'nothing', method: 'rag' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleMemorySearch('nothing');
    expect(result.content[0].text).toBe('No memories found matching your query.');
  });

  it('returns "No memories found" when results is undefined', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { query: 'nothing', method: 'rag' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleMemorySearch('nothing');
    expect(result.content[0].text).toBe('No memories found matching your query.');
  });

  it('returns error message when server unreachable', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: false,
      error: 'Jarvis server unreachable: ECONNREFUSED',
    } as JarvisResult<unknown>);

    const result = await handleMemorySearch('test');
    expect(result.content[0].text).toBe('Jarvis server unreachable: ECONNREFUSED');
  });

  it('returns error message when server returns error', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: false,
      error: 'Server error: MEMU_ERROR - search failed',
    } as JarvisResult<unknown>);

    const result = await handleMemorySearch('test');
    expect(result.content[0].text).toBe('Server error: MEMU_ERROR - search failed');
  });

  it('calls jarvisPost with correct path and body', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { results: [], query: 'test', method: 'rag' }, status: 'ok' },
    } as JarvisResult<unknown>);

    await handleMemorySearch('my query');
    expect(mockJarvisPost).toHaveBeenCalledWith('/memory/search', { query: 'my query', method: 'rag' });
  });
});
