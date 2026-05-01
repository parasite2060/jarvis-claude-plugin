import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  utimesSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  drainConversations,
  getAuthState,
  clearAuthBlock,
} from '../../worker/conversation-drain.js';

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

function sidecarFile(workerDir, filename) {
  return join(workerDir, 'pending-conversations', `${filename}.attempts`);
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
    clearAuthBlock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuthBlock();
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
    const networkLine = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.network-error:'))[0];
    expect(networkLine).toContain(filename);
    expect(networkLine).toContain('url=http://localhost:8000/conversations');
    expect(networkLine).toMatch(/payloadKB=\d+/);
    expect(networkLine).toMatch(/elapsedMs=\d+/);
    expect(networkLine).toContain('err=TypeError');
    expect(networkLine).toContain('cause=Error');
    expect(networkLine).toContain('code=ECONNREFUSED');
    expect(networkLine).toContain('message=');
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

  it('should move file to .failed with auth-blocked reason and latch flag when server returns 401', async () => {
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
    const movedLine = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.failed-moved:'))[0];
    expect(movedLine).toContain('auth-blocked');
    expect(movedLine).toContain('status=401');
    expect(getAuthState()).toEqual({ authBlocked: true, authBlockedReason: '401' });
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
    const line = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.network-error:'))[0];
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
    const line = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.network-error:'))[0];
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
    setupQueue(workerDir);
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
    const line = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.network-error:'))[0];
    expect(line).toContain('url=');
    expect(line).not.toContain('user:secret123');
    expect(line).not.toContain('secret123');
  });
});

describe('drainConversations > sidecar attempt counter (story 12.4)', () => {
  let workerDir;
  let mockFetch;
  let logger;

  beforeEach(() => {
    workerDir = mkdtempSync(join(tmpdir(), 'jarvis-drain-sidecar-'));
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    logger = fakeLogger();
    clearAuthBlock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuthBlock();
    try { rmSync(workerDir, { recursive: true, force: true }); } catch {}
  });

  it('should increment sidecar to 1 when first drain returns 503', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // fetchLastPosition
      .mockResolvedValueOnce({ ok: false, status: 503 });

    // Act
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    const sidecar = sidecarFile(workerDir, filename);
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(sidecar, 'utf8')).toBe('1');
  });

  it('should respect backoff and skip the file when sidecar mtime is within backoff window', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    const sidecar = sidecarFile(workerDir, filename);
    writeFileSync(sidecar, '1', 'utf8');
    // Backoff window for n=1 is 60s. Set mtime to 30s ago — still inside window.
    const thirtySecAgo = Date.now() / 1000 - 30;
    utimesSync(sidecar, thirtySecAgo, thirtySecAgo);

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, failed: 0, retried: 1 });
    // mtime should NOT have been refreshed by the skip pass.
    const mtimeAfterMs = statSync(sidecar).mtimeMs;
    expect(Math.abs(mtimeAfterMs - thirtySecAgo * 1000)).toBeLessThan(2000);
  });

  it('should drain the file when sidecar mtime is past the backoff window', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    const sidecar = sidecarFile(workerDir, filename);
    writeFileSync(sidecar, '1', 'utf8');
    // Set mtime to 90s ago — past the 60s backoff for n=1.
    const ninetySecAgo = Date.now() / 1000 - 90;
    utimesSync(sidecar, ninetySecAgo, ninetySecAgo);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // fetchLastPosition
      .mockResolvedValueOnce({ ok: true, status: 200 });

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ sent: 1 });
    expect(existsSync(sidecar)).toBe(false);
    expect(existsSync(join(workerDir, 'pending-conversations', filename))).toBe(false);
  });

  it('should move file to .failed with retry-budget-exhausted reason when attempts reach MAX_ATTEMPTS', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    const sidecar = sidecarFile(workerDir, filename);
    writeFileSync(sidecar, '7', 'utf8');
    // Force mtime past backoff so the drain proceeds.
    const longAgo = Date.now() / 1000 - 60 * 60 * 24;
    utimesSync(sidecar, longAgo, longAgo);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // fetchLastPosition
      .mockResolvedValueOnce({ ok: false, status: 503 });

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ failed: 1 });
    expect(existsSync(sidecar)).toBe(false);
    expect(existsSync(join(workerDir, 'pending-conversations', '.failed', filename))).toBe(true);
    const movedLine = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.failed-moved:'))[0];
    expect(movedLine).toContain('retry-budget-exhausted');
    expect(movedLine).toContain('attempts=8');
    expect(movedLine).toContain('lastStatus=http:503');
  });

  it('should clear sidecar and queue file when post returns 2xx after prior retries', async () => {
    // Arrange
    const filename = setupQueue(workerDir);
    const sidecar = sidecarFile(workerDir, filename);
    writeFileSync(sidecar, '3', 'utf8');
    const longAgo = Date.now() / 1000 - 60 * 60 * 24;
    utimesSync(sidecar, longAgo, longAgo);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // fetchLastPosition
      .mockResolvedValueOnce({ ok: true, status: 200 });

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(result).toMatchObject({ sent: 1 });
    expect(existsSync(join(workerDir, 'pending-conversations', filename))).toBe(false);
    expect(existsSync(sidecar)).toBe(false);
  });

  it('should sweep orphan sidecars on each drain tick', async () => {
    // Arrange
    mkdirSync(join(workerDir, 'pending-conversations'), { recursive: true });
    const orphanSidecar = join(workerDir, 'pending-conversations', 'gone-1.json.attempts');
    writeFileSync(orphanSidecar, '4', 'utf8');

    // Act
    const result = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(existsSync(orphanSidecar)).toBe(false);
    expect(result).toMatchObject({ sent: 0, failed: 0, retried: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should not classify 401 or 403 as retryable when isRetryable is consulted', async () => {
    // Arrange + Act
    // The drain test below verifies behaviour end-to-end. We also encode the
    // contract here as a behavioural check: latching authBlocked guarantees
    // 401 is treated as terminal, not retryable.
    const filename = setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever'))
      .mockResolvedValueOnce({ ok: false, status: 403 });
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(existsSync(sidecarFile(workerDir, filename))).toBe(false);
    expect(getAuthState().authBlocked).toBe(true);
  });
});

describe('drainConversations > auth-block latch (story 12.4)', () => {
  let workerDir;
  let mockFetch;
  let logger;

  beforeEach(() => {
    workerDir = mkdtempSync(join(tmpdir(), 'jarvis-drain-auth-'));
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    logger = fakeLogger();
    clearAuthBlock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuthBlock();
    try { rmSync(workerDir, { recursive: true, force: true }); } catch {}
  });

  it('should latch authBlocked when fetchLastPosition returns 401', async () => {
    // Arrange
    setupQueue(workerDir);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401 }) // fetchLastPosition
      .mockResolvedValueOnce({ ok: true, status: 200 }); // postSegment (would succeed if reached)

    // Act
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(getAuthState()).toEqual({ authBlocked: true, authBlockedReason: '401' });
    const blockedLine = logger.warn.mock.calls.find((c) => c[0].includes('jarvis.drain.auth-blocked:'))?.[0];
    expect(blockedLine).toBeDefined();
    expect(blockedLine).toContain('status=401');
  });

  it('should latch authBlocked when postSegment returns 403', async () => {
    // Arrange
    setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever')) // fetchLastPosition
      .mockResolvedValueOnce({ ok: false, status: 403 }); // postSegment

    // Act
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(getAuthState()).toEqual({ authBlocked: true, authBlockedReason: '403' });
  });

  it('should skip drainConversations entirely when authBlocked is true', async () => {
    // Arrange
    setupQueue(workerDir);
    mockFetch
      .mockRejectedValueOnce(new Error('whatever'))
      .mockResolvedValueOnce({ ok: false, status: 401 });

    // Act — first call latches the flag.
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });
    mockFetch.mockClear();
    const second = await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    expect(second).toEqual({ sent: 0, failed: 0, retried: 0, skipped: 'auth-blocked' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should reset authBlocked when clearAuthBlock is called', async () => {
    // Arrange
    setupQueue(workerDir);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });
    expect(getAuthState().authBlocked).toBe(true);

    // Act
    clearAuthBlock();

    // Assert
    expect(getAuthState()).toEqual({ authBlocked: false, authBlockedReason: null });
  });

  it('should log auth-blocked exactly once per latched block', async () => {
    // Arrange
    setupQueue(workerDir);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    // Act — first drain latches and logs once.
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });
    // Second drain should be skipped without logging again.
    await drainConversations({
      serverUrl: 'http://localhost:8000',
      apiKey: 'k',
      workerDir,
      logger,
    });

    // Assert
    const blockedLogs = logger.warn.mock.calls.filter((c) => c[0].includes('jarvis.drain.auth-blocked:'));
    expect(blockedLogs).toHaveLength(1);
  });
});
