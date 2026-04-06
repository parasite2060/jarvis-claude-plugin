import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const TEST_CACHE_DIR = '/tmp/test-jarvis-cache';

describe('worker-manager', () => {
  let ensureWorkerRunning;
  let mockFetch;
  let spawnMock;
  let fsMocks;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_WORKERPORT', '39999');
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_CACHEDIR', TEST_CACHE_DIR);
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const cp = await import('node:child_process');
    spawnMock = cp.spawn;

    const fs = await import('node:fs');
    fsMocks = fs;

    const mod = await import('../../hooks/lib/worker-manager.js');
    ensureWorkerRunning = mod.ensureWorkerRunning;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns without spawning when health check succeeds', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await ensureWorkerRunning();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('attempts to start worker when health check fails and no PID file', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(false);
    spawnMock.mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
    });

    await ensureWorkerRunning();

    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      [expect.stringContaining('worker')],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.worker.pid'),
      '12345',
      'utf8',
    );
  });

  it('handles stale PID file (process not alive)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('99999');

    // Mock process.kill to throw (process not alive)
    const originalKill = process.kill;
    process.kill = vi.fn(() => { throw new Error('ESRCH'); });

    spawnMock.mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
    });

    await ensureWorkerRunning();

    expect(fsMocks.unlinkSync).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('skips spawn when PID file exists and process is alive', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('12345');

    // Mock process.kill to succeed (process is alive)
    const originalKill = process.kill;
    process.kill = vi.fn();

    await ensureWorkerRunning();

    expect(spawnMock).not.toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('never throws on any error path', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockImplementation(() => { throw new Error('FS error'); });

    await expect(ensureWorkerRunning()).resolves.toBeUndefined();
  });

  it('creates cache directory before spawning', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(false);
    spawnMock.mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
    });

    await ensureWorkerRunning();

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
      TEST_CACHE_DIR,
      { recursive: true },
    );
  });
});
