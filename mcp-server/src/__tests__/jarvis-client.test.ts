import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { jarvisPost, jarvisGet } = await import('../lib/jarvis-client.js');

beforeEach(() => {
  mockFetch.mockReset();
});

describe('jarvisPost', () => {
  it('returns ok with data on 200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { results: [] }, status: 'ok' }),
    });

    const result = await jarvisPost('/memory/search', { query: 'test' });
    expect(result).toEqual({ ok: true, data: { data: { results: [] }, status: 'ok' } });
  });

  it('returns error with extracted message on 4xx/5xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'MEMU_ERROR', message: 'search failed' }, status: 'error' }),
    });

    const result = await jarvisPost('/memory/search', { query: 'test' });
    expect(result).toEqual({ ok: false, error: 'Server error: MEMU_ERROR - search failed' });
  });

  it('returns error with HTTP status when body has no error details', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'not found' }),
    });

    const result = await jarvisPost('/test', {});
    expect(result).toEqual({ ok: false, error: 'Server error: HTTP 404' });
  });

  it('returns error with HTTP status when body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not JSON'); },
    });

    const result = await jarvisPost('/test', {});
    expect(result).toEqual({ ok: false, error: 'Server error: HTTP 502' });
  });

  it('returns unreachable error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await jarvisPost('/memory/search', { query: 'test' });
    expect(result).toEqual({ ok: false, error: 'Jarvis server unreachable: ECONNREFUSED' });
  });

  it('sends correct headers and body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    await jarvisPost('/memory/add', { content: 'hello' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/memory/add',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'hello' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});

describe('jarvisGet', () => {
  it('returns ok with data on 200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { health: 'ok' }, status: 'ok' }),
    });

    const result = await jarvisGet('/health');
    expect(result).toEqual({ ok: true, data: { data: { health: 'ok' }, status: 'ok' } });
  });

  it('returns error with extracted message on 4xx/5xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'bad key' }, status: 'error' }),
    });

    const result = await jarvisGet('/health');
    expect(result).toEqual({ ok: false, error: 'Server error: UNAUTHORIZED - bad key' });
  });

  it('returns unreachable error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await jarvisGet('/health');
    expect(result).toEqual({ ok: false, error: 'Jarvis server unreachable: ECONNREFUSED' });
  });
});
