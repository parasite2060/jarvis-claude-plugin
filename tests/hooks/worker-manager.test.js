import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(__dirname, '../../package.json');
const PLUGIN_VERSION = JSON.parse(await readFile(PKG_PATH, 'utf8')).version;

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

vi.mock('node:net', () => ({
  createConnection: vi.fn(),
}));

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

describe('worker-manager', () => {
  let ensureWorkerRunning;
  let mockFetch;
  let spawnMock;
  let fsMocks;
  let netMocks;

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

    const net = await import('node:net');
    netMocks = net;
    netMocks.createConnection.mockImplementation(() => mockPortFree());

    // worker-manager reads package.json at module load — provide the real version.
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
  });

  it('returns without spawning when health version matches plugin version', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: PLUGIN_VERSION }),
    });

    await ensureWorkerRunning();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('terminates and respawns worker when version mismatches', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '0.0.1-old' }),
    });
    fsMocks.existsSync.mockReturnValue(true);
    // PID file content; package.json read handled in beforeEach.
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

    await ensureWorkerRunning();

    expect(killMock).toHaveBeenCalledWith(54321, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('attempts to start worker when health is unreachable and no PID file', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    fsMocks.existsSync.mockReturnValue(false);
    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

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
    fsMocks.readFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return JSON.stringify({ version: PLUGIN_VERSION });
      }
      return '99999';
    });

    const originalKill = process.kill;
    process.kill = vi.fn(() => { throw new Error('ESRCH'); });

    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

    await ensureWorkerRunning();

    expect(fsMocks.unlinkSync).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalled();

    process.kill = originalKill;
  });

  it('terminates wedged worker when PID is alive but health is unreachable', async () => {
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

    await ensureWorkerRunning();

    expect(killMock).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();

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
    spawnMock.mockReturnValue({ pid: 12345, unref: vi.fn(), on: vi.fn() });

    await ensureWorkerRunning();

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
      TEST_CACHE_DIR,
      { recursive: true },
    );
  });
});
