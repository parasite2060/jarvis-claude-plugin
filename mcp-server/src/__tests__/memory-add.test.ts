import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JarvisResult } from '../lib/jarvis-client.js';

vi.mock('../lib/jarvis-client.js', () => ({
  jarvisPost: vi.fn(),
}));

const { jarvisPost } = await import('../lib/jarvis-client.js');
const { handleMemoryAdd } = await import('../tools/memory-add.js');
const mockJarvisPost = vi.mocked(jarvisPost);

beforeEach(() => {
  mockJarvisPost.mockReset();
});

describe('handleMemoryAdd', () => {
  it('returns confirmation with memory ID on success', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { memoryId: 'mem-123', status: 'accepted' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleMemoryAdd('Use async everywhere', 'coding standard');
    expect(result.content[0].text).toBe('Memory stored successfully (ID: mem-123)');
  });

  it('returns error message when server unreachable', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: false,
      error: 'Jarvis server unreachable: ECONNREFUSED',
    } as JarvisResult<unknown>);

    const result = await handleMemoryAdd('test content');
    expect(result.content[0].text).toBe('Jarvis server unreachable: ECONNREFUSED');
  });

  it('returns error message when server returns error', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: false,
      error: 'Server error: MEMU_ERROR - storage failed',
    } as JarvisResult<unknown>);

    const result = await handleMemoryAdd('test content');
    expect(result.content[0].text).toBe('Server error: MEMU_ERROR - storage failed');
  });

  it('calls jarvisPost with correct path and body including context', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { memoryId: 'mem-456', status: 'accepted' }, status: 'ok' },
    } as JarvisResult<unknown>);

    await handleMemoryAdd('my memory', 'some context');
    expect(mockJarvisPost).toHaveBeenCalledWith('/memory/add', {
      content: 'my memory',
      metadata: { context: 'some context' },
    });
  });

  it('calls jarvisPost with undefined context when not provided', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { memoryId: 'mem-789', status: 'accepted' }, status: 'ok' },
    } as JarvisResult<unknown>);

    await handleMemoryAdd('my memory');
    expect(mockJarvisPost).toHaveBeenCalledWith('/memory/add', {
      content: 'my memory',
      metadata: { context: undefined },
    });
  });

  it('handles missing memoryId in response gracefully', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { status: 'accepted' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleMemoryAdd('test');
    expect(result.content[0].text).toBe('Memory stored successfully (ID: unknown)');
  });
});
