import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MOCK_SERVER_URL = 'http://localhost:19876';

describe('jarvis-client', () => {
  let getContext;
  let mockFetch;

  beforeEach(async () => {
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_serverUrl', MOCK_SERVER_URL);
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_apiKey', 'test-key');
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Dynamic import to pick up stubbed env vars
    const mod = await import('../../hooks/lib/jarvis-client.js');
    getContext = mod.getContext;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('extracts data.data.context string from server response', async () => {
    const contextString = '## SOUL\n\nBe helpful.\n\n## IDENTITY\n\nSoftware engineer.';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          context: contextString,
          cached: true,
          assembledAt: '2026-03-30T10:00:00Z',
        },
        status: 'ok',
      }),
    });

    const result = await getContext();
    expect(result).toBe(contextString);
  });

  it('returns null when server response has no nested context field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { cached: true },
        status: 'ok',
      }),
    });

    const result = await getContext();
    expect(result).toBeNull();
  });

  it('returns null when server response data is a plain string (malformed)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: 'unexpected-string',
        status: 'ok',
      }),
    });

    const result = await getContext();
    expect(result).toBeNull();
  });

  it('returns null when server response is completely empty object', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const result = await getContext();
    expect(result).toBeNull();
  });

  it('returns null when server is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await getContext();
    expect(result).toBeNull();
  });

  it('returns null when server returns non-ok status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await getContext();
    expect(result).toBeNull();
  });
});
