import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
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
});
