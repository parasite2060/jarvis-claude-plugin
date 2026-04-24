import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JarvisResult } from '../lib/jarvis-client.js';

vi.mock('../lib/jarvis-client.js', () => ({
  jarvisPost: vi.fn(),
}));

const { jarvisPost } = await import('../lib/jarvis-client.js');
const { handleDream } = await import('../tools/dream.js');
const mockJarvisPost = vi.mocked(jarvisPost);

beforeEach(() => {
  mockJarvisPost.mockReset();
});

describe('handleDream', () => {
  it('returns queued confirmation on success', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { status: 'queued' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleDream();
    expect(result.content[0].text).toContain('Dream queued');
    expect(result.content[0].text).toContain('/recall');
  });

  it('returns error message when server returns error', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: false,
      error: 'Server error: DREAM_FAILED - pipeline crash',
    } as JarvisResult<unknown>);

    const result = await handleDream();
    expect(result.content[0].text).toBe('Server error: DREAM_FAILED - pipeline crash');
  });

  it('passes through network unreachable error', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: false,
      error: 'Jarvis server unreachable: ECONNREFUSED',
    } as JarvisResult<unknown>);

    const result = await handleDream();
    expect(result.content[0].text).toBe('Jarvis server unreachable: ECONNREFUSED');
  });

  it('calls jarvisPost on /dream with empty body', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { status: 'queued' }, status: 'ok' },
    } as JarvisResult<unknown>);

    await handleDream();
    expect(mockJarvisPost).toHaveBeenCalledWith('/dream', {});
  });

  it('sends empty body when no source_date provided', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { status: 'queued' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleDream();
    expect(mockJarvisPost).toHaveBeenCalledWith('/dream', {});
    expect(result.content[0].text).toContain('Dream queued. Deep consolidation');
  });

  it('forwards source_date in body and response text', async () => {
    mockJarvisPost.mockResolvedValueOnce({
      ok: true,
      data: { data: { status: 'queued' }, status: 'ok' },
    } as JarvisResult<unknown>);

    const result = await handleDream({ source_date: '2026-04-20' });
    expect(mockJarvisPost).toHaveBeenCalledWith('/dream', { source_date: '2026-04-20' });
    expect(result.content[0].text).toContain('Dream queued for 2026-04-20');
  });
});
