import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';

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

describe('getSoul', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns content from /memory/soul', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/memory/soul' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          data: { content: 'soul content here', filePath: 'SOUL.md' },
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', `http://127.0.0.1:${port}`);
    vi.resetModules();
    const { getSoul } = await import('../../hooks/lib/jarvis-client.js');
    const result = await getSoul();
    expect(result).toBe('soul content here');
    server.close();
  });

  it('returns null when server is unreachable', async () => {
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', 'http://127.0.0.1:19998');
    vi.resetModules();
    const { getSoul } = await import('../../hooks/lib/jarvis-client.js');
    const result = await getSoul();
    expect(result).toBeNull();
  });
});

describe('getIdentity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns content from /memory/identity', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/memory/identity' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          data: { content: 'identity content', filePath: 'IDENTITY.md' },
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', `http://127.0.0.1:${port}`);
    vi.resetModules();
    const { getIdentity } = await import('../../hooks/lib/jarvis-client.js');
    const result = await getIdentity();
    expect(result).toBe('identity content');
    server.close();
  });
});

describe('getMemory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns content from /memory/memory', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/memory/memory' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          data: { content: 'memory content', filePath: 'MEMORY.md' },
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', `http://127.0.0.1:${port}`);
    vi.resetModules();
    const { getMemory } = await import('../../hooks/lib/jarvis-client.js');
    const result = await getMemory();
    expect(result).toBe('memory content');
    server.close();
  });
});

describe('getFileManifest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns files array with mtime from /memory/files/manifest', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/memory/files/manifest' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          data: {
            files: [
              { path: 'decisions/foo.md', hash: 'abc', size: 100, updatedAt: '2026-04-26T10:00:00+00:00' },
              { path: 'decisions/bar.md', hash: 'def', size: 200, updatedAt: '2026-04-25T10:00:00+00:00' },
            ],
            manifestHash: 'h',
            fileCount: 2,
            generatedAt: '2026-04-26T10:00:00+00:00',
          },
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', `http://127.0.0.1:${port}`);
    vi.resetModules();
    const { getFileManifest } = await import('../../hooks/lib/jarvis-client.js');
    const result = await getFileManifest();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: 'decisions/foo.md', updatedAt: '2026-04-26T10:00:00+00:00' });
    server.close();
  });

  it('returns empty array when server is unreachable', async () => {
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', 'http://127.0.0.1:19997');
    vi.resetModules();
    const { getFileManifest } = await import('../../hooks/lib/jarvis-client.js');
    const result = await getFileManifest();
    expect(result).toEqual([]);
  });
});
