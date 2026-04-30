import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';

const MOCK_SERVER_URL = 'http://localhost:19876';

describe('jarvis-client > getContext', () => {
  let getContext;
  let mockFetch;

  beforeEach(async () => {
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_serverUrl', MOCK_SERVER_URL);
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_apiKey', 'test-key');
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const mod = await import('../../hooks/lib/jarvis-client.js');
    getContext = mod.getContext;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return data.data.context when server returns a well-formed envelope', async () => {
    // Arrange
    const contextString = '## SOUL\n\nBe helpful.\n\n## IDENTITY\n\nSoftware engineer.';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { context: contextString, cached: true, assembledAt: '2026-03-30T10:00:00Z' },
        status: 'ok',
      }),
    });

    // Act
    const result = await getContext();

    // Assert
    expect(result).toBe(contextString);
  });

  it('should return null when response data has no nested context field', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { cached: true }, status: 'ok' }),
    });

    // Act
    const result = await getContext();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when response data is a string instead of an object', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'unexpected-string', status: 'ok' }),
    });

    // Act
    const result = await getContext();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when response is an empty object', async () => {
    // Arrange
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    // Act
    const result = await getContext();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when server is unreachable', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    // Act
    const result = await getContext();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when server returns non-ok status', async () => {
    // Arrange
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    // Act
    const result = await getContext();

    // Assert
    expect(result).toBeNull();
  });
});

describe('jarvis-client > getSoul', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return content from /memory/soul when server returns it', async () => {
    // Arrange
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

    // Act
    const result = await getSoul();

    // Assert
    expect(result).toBe('soul content here');
    server.close();
  });

  it('should return null when server is unreachable', async () => {
    // Arrange
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', 'http://127.0.0.1:19998');
    vi.resetModules();
    const { getSoul } = await import('../../hooks/lib/jarvis-client.js');

    // Act
    const result = await getSoul();

    // Assert
    expect(result).toBeNull();
  });
});

describe('jarvis-client > getIdentity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return content from /memory/identity when server returns it', async () => {
    // Arrange
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

    // Act
    const result = await getIdentity();

    // Assert
    expect(result).toBe('identity content');
    server.close();
  });
});

describe('jarvis-client > getMemory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return content from /memory/memory when server returns it', async () => {
    // Arrange
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

    // Act
    const result = await getMemory();

    // Assert
    expect(result).toBe('memory content');
    server.close();
  });
});

describe('jarvis-client > getFileManifest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return files array with mtime when server returns the manifest', async () => {
    // Arrange
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

    // Act
    const result = await getFileManifest();

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: 'decisions/foo.md', updatedAt: '2026-04-26T10:00:00+00:00' });
    server.close();
  });

  it('should return empty array when server is unreachable', async () => {
    // Arrange
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_SERVERURL', 'http://127.0.0.1:19997');
    vi.resetModules();
    const { getFileManifest } = await import('../../hooks/lib/jarvis-client.js');

    // Act
    const result = await getFileManifest();

    // Assert
    expect(result).toEqual([]);
  });
});
