import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  // openSync / closeSync / statSync / unlinkSync are passed through to the
  // real fs so the on-disk lock file used by `withLock` (lib/file-lock.js)
  // works against tmpdir during these tests.
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:net', () => ({
  createConnection: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(__dirname, '../../package.json');
const PLUGIN_VERSION = JSON.parse(await readFile(PKG_PATH, 'utf8')).version;

const TEST_CACHE_DIR = '/tmp/test-jarvis-cache';

function mockPortFree() {
  const sock = {
    setTimeout: vi.fn(),
    once: vi.fn((event, cb) => {
      if (event === 'error') queueMicrotask(() => cb({ code: 'ECONNREFUSED' }));
    }),
    destroy: vi.fn(),
  };
  return sock;
}

describe('worker-manager > ensureWorkerRunning', () => {
  let ensureWorkerRunning;
  let mockFetch;
  let spawnMock;
  let fsMocks;
  let netMocks;
  let tmpWorkerDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tmpWorkerDir = mkdtempSync(join(tmpdir(), 'jarvis-wm-'));
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_WORKERPORT', '39999');
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_CACHEDIR', TEST_CACHE_DIR);
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_WORKERDIR', tmpWorkerDir);
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const cp = await import('node:child_process');
    spawnMock = cp.spawn;

    const fs = await import('node:fs');
    fsMocks = fs;

    const net = await import('node:net');
    netMocks = net;
    netMocks.createConnection.mockImplementation(() => mockPortFree());

    fsMocks.readFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return JSON.stringify({ version: PLUGIN_VERSION });
      }
      return '';
    });

    const mod = await import('../../hooks/lib/worker-manager.js');
    ensureWorkerRunning = mod.ensureWorkerRunning;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    try { rmSync(tmpWorkerDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should not spawn when health version matches plugin version', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: PLUGIN_VERSION }),
    });

    // Act
    await ensureWorkerRunning();

    // Assert
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('should terminate and respawn when health version differs from plugin version', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '0.0.1-old' }),
    });
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return JSON.stringify({ version: PLUGIN_VERSION });
      }
      return '54321';
    });
    const originalKill = process.kill;
    const killMock = vi.fn();
    process.kill = killMock;
    spawnMock.mockReturnValue({ pid: 99999, unref: vi.fn(), on: vi.fn() });

    // Act
    await ensureWorkerRunning();

    // Assert
    expect(killMock).toHaveBeenCalledWith(54321, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('should spawn worker when health is unreachable and no PID file exists', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(false);
    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

    // Act
    await ensureWorkerRunning();

    // Assert
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

  it('should clear PID file and respawn when PID file is stale (process not alive)', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return JSON.stringify({ version: PLUGIN_VERSION });
      }
      return '99999';
    });
    const originalKill = process.kill;
    process.kill = vi.fn(() => { throw new Error('ESRCH'); });
    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

    // Act
    await ensureWorkerRunning();

    // Assert
    expect(fsMocks.unlinkSync).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('should terminate the running PID and respawn when PID is alive but health is unreachable', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return JSON.stringify({ version: PLUGIN_VERSION });
      }
      return '12345';
    });
    const originalKill = process.kill;
    const killMock = vi.fn();
    process.kill = killMock;
    spawnMock.mockReturnValue({ pid: 99999, unref: vi.fn(), on: vi.fn() });

    // Act
    await ensureWorkerRunning();

    // Assert
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('should not throw when any internal call throws', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockImplementation(() => { throw new Error('FS error'); });

    // Act & Assert
    await expect(ensureWorkerRunning()).resolves.toBeUndefined();
  });

  it('should create the cache directory before spawning the worker', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(false);
    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

    // Act
    await ensureWorkerRunning();

    // Assert
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
      TEST_CACHE_DIR,
      { recursive: true },
    );
  });

  it('should spawn exactly once when two ensureWorkerRunning calls race', async () => {
    // Arrange — both invocations decide to spawn (health=null on the first
    // probe). Only one should win the spawn lock; the other re-checks health
    // inside the lock, sees the now-running worker, and returns.
    fsMocks.existsSync.mockReturnValue(false);
    let healthCalls = 0;
    mockFetch.mockImplementation(async () => {
      healthCalls += 1;
      // Calls 1–3: outer probes (×2) + winner's inner re-check return
      // unreachable so the winner proceeds to spawn. Call 4: loser's inner
      // re-check (after the winner exits the lock) sees a matching-version
      // worker and bails without a second spawn.
      if (healthCalls <= 3) {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ status: 'ok', version: PLUGIN_VERSION }) };
    });
    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

    // Act
    await Promise.all([ensureWorkerRunning(), ensureWorkerRunning()]);

    // Assert
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

describe('worker-manager > workerDir drift detection', () => {
  let mockFetch;
  let spawnMock;
  let fsMocks;
  let netMocks;
  let stderrSpy;

  async function loadEnsureWorkerRunning(hookWorkerDir) {
    vi.resetModules();
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_WORKERPORT', '39999');
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_CACHEDIR', TEST_CACHE_DIR);
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_WORKERDIR', hookWorkerDir);
    const mod = await import('../../hooks/lib/worker-manager.js');
    return mod.ensureWorkerRunning;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const cp = await import('node:child_process');
    spawnMock = cp.spawn;

    const fs = await import('node:fs');
    fsMocks = fs;

    const net = await import('node:net');
    netMocks = net;
    netMocks.createConnection.mockImplementation(() => mockPortFree());

    fsMocks.readFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return JSON.stringify({ version: PLUGIN_VERSION });
      }
      return '';
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    stderrSpy.mockRestore();
  });

  it('should not log drift when hook and worker workerDir match', async () => {
    // Arrange
    const sharedPath = '/abs/path/worker';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: PLUGIN_VERSION, workerDir: sharedPath }),
    });
    const ensureWorkerRunning = await loadEnsureWorkerRunning(sharedPath);

    // Act
    await ensureWorkerRunning();

    // Assert
    const driftLines = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('workerdir-drift'));
    expect(driftLines).toEqual([]);
  });

  it('should log exactly one drift line when hook and worker workerDir mismatch', async () => {
    // Arrange
    const hookPath = '/abs/path/Y';
    const workerPath = '/abs/path/X';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: PLUGIN_VERSION, workerDir: workerPath }),
    });
    const ensureWorkerRunning = await loadEnsureWorkerRunning(hookPath);

    // Act
    await ensureWorkerRunning();

    // Assert
    const driftLines = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('workerdir-drift'));
    expect(driftLines).toHaveLength(1);
    expect(driftLines[0]).toContain(`hook=${hookPath}`);
    expect(driftLines[0]).toContain(`worker=${workerPath}`);
    // Warning is purely diagnostic — no spawn or terminate side-effects.
    expect(spawnMock).not.toHaveBeenCalled();
    expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
  });

  it('should not log drift when worker /health payload omits workerDir (older worker)', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: PLUGIN_VERSION }),
    });
    const ensureWorkerRunning = await loadEnsureWorkerRunning('/abs/path/Y');

    // Act
    await ensureWorkerRunning();

    // Assert
    const driftLines = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('workerdir-drift'));
    expect(driftLines).toEqual([]);
  });

  it('should not log drift when hook config uses tilde and worker reports the absolute equivalent', async () => {
    // Arrange
    const { homedir } = await import('node:os');
    const hookConfigPath = '~/.jarvis-cache/worker';
    const workerReportedPath = `${homedir()}/.jarvis-cache/worker`;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: PLUGIN_VERSION, workerDir: workerReportedPath }),
    });
    const ensureWorkerRunning = await loadEnsureWorkerRunning(hookConfigPath);

    // Act
    await ensureWorkerRunning();

    // Assert
    const driftLines = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('workerdir-drift'));
    expect(driftLines).toEqual([]);
  });
});
