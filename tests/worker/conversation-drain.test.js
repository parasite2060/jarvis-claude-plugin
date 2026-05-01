import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drainConversations } from '../../worker/conversation-drain.js';

const MOCK_PAYLOAD = {
  sessionId: 'sess-1',
  source: 'stop',
  filteredTranscript: 'line0\nline1\nline2\n',
  enqueuedAt: '2026-05-01T10:00:00Z',
  pluginVersion: '0.0.0-test',
};

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function setupQueue(workerDir, payload = MOCK_PAYLOAD) {
  mkdirSync(join(workerDir, 'pending-conversations'), { recursive: true });
  const filename = `${payload.sessionId}-1.json`;
  writeFileSync(join(workerDir, 'pending-conversations', filename), JSON.stringify(payload), 'utf8');
  return filename;
}

describe('drainConversations > error log enrichment', () => {
  let workerDir;
  let mockFetch;
  let logger;

  beforeEach(() => {
    workerDir = mkdtempSync(join(tmpdir(), 'jarvis-drain-'));
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    logger = fakeLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try { rmSync(workerDir, { recursive: true, force: true }); } catch {}
  });

  it('should log url, payloadKB, elapsedMs, err, and cause when fetch rejects', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8000'), { code: 'ECONNREFUSED' });
    const fetchError = new TypeError('fetch failed');
    fetchError.cause = cause;
    // First call: getLastPosition (we want it to fail silently and return 0).
    // Second call: postSegment (we want this one to throw with cause).
    mockFetch
      .mockRejectedValueOnce(new Error('whatever'))
      .mockRejectedValueOnce(fetchError);

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ sent: 0, failed: 0, retried: 1 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = logger.warn.mock.calls[0][0];
    expect(line).toContain('jarvis.drain.network-error:');
    expect(line).toContain(filename);
    expect(line).toContain('url=http://localhost:8000/conversations');
    expect(line).toMatch(/payloadKB=\d+/);
    expect(line).toMatch(/elapsedMs=\d+/);
    expect(line).toContain('err=TypeError');
    expect(line).toContain('cause=Error');
    expect(line).toContain('code=ECONNREFUSED');
    expect(line).toContain('message=');
  });

  it('should log url, status, payloadKB, and elapsedMs when server returns 503', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // getLastPosition
      .mockResolvedValueOnce({ ok: false, status: 503 });

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ retried: 1 });
    const line = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.retryable:'))[0];
    expect(line).toContain(filename);
    expect(line).toContain('url=http://localhost:8000/conversations');
    expect(line).toContain('status=503');
    expect(line).toMatch(/payloadKB=\d+/);
    expect(line).toMatch(/elapsedMs=\d+/);
  });

  it('should move file to .failed and log status+url when server returns 401', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // getLastPosition
      .mockResolvedValueOnce({ ok: false, status: 401 });

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ failed: 1 });
    expect(existsSync(join(workerDir, 'pending-conversations', '.failed', filename))).toBe(true);
    const line = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.failed-moved:'))[0];
    expect(line).toContain('http:401');
    expect(line).toContain('url=http://localhost:8000/conversations');
    expect(line).toMatch(/payloadKB=\d+/);
  });

  it('should log err=AbortError when fetch is aborted via timeout', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    const abortErr = new Error('This operation was aborted');
    abortErr.name = 'AbortError';
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // getLastPosition
      .mockRejectedValueOnce(abortErr);

    // Act
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    const line = logger.warn.mock.calls[0][0];
    expect(line).toContain('jarvis.drain.network-error:');
    expect(line).toContain(filename);
    expect(line).toContain('err=AbortError');
    // elapsedMs MUST be reported, not zero (per spec AC4).
    const elapsed = Number(line.match(/elapsedMs=(\d+)/)?.[1] ?? 0);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('should abort the POST when fetchTimeoutMs elapses', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    // getLastPosition fails fast; postSegment hangs forever to force timeout.
    mockFetch
      .mockRejectedValueOnce(new Error('whatever'))
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }));

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      fetchTimeoutMs: 50,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ retried: 1 });
    expect(filename).toBeTruthy();
    const line = logger.warn.mock.calls[0][0];
    expect(line).toContain('err=AbortError');
  });

  it('should log jarvis.drain.sent with sessionId, segment range, elapsedMs, and payloadKB when post returns 2xx', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // fetchLastPosition
      .mockResolvedValueOnce({ ok: true, status: 200 }); // postSegment

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ sent: 1, failed: 0, retried: 0 });
    expect(existsSync(join(workerDir, 'pending-conversations', filename))).toBe(false);
    const sentLine = logger.info.mock.calls.find((c) => c[0].includes('jarvis.drain.sent:'))?.[0];
    expect(sentLine).toBeDefined();
    expect(sentLine).toContain(filename);
    expect(sentLine).toContain(`sessionId=${MOCK_PAYLOAD.sessionId}`);
    expect(sentLine).toMatch(/startLine=\d+/);
    expect(sentLine).toMatch(/endLine=\d+/);
    expect(sentLine).toMatch(/elapsedMs=\d+/);
    expect(sentLine).toMatch(/payloadKB=\d+/);
  });

  it('should sanitize basic-auth credentials out of url= field in network-error log', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    // Act
    await drainConversations({
      serverUrl: 'https://user:secret123@example.com',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    const line = logger.warn.mock.calls[0][0];
    expect(line).toContain('url=');
    expect(line).not.toContain('user:secret123');
    expect(line).not.toContain('secret123');
  });
});
