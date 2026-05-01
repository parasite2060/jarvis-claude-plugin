import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = join(__dirname, '..', '..', 'worker', 'server.js');

let portCounter = 41000;

function request(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForServer(port, maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path: '/health' }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve());
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) return reject(new Error(`Server did not start on port ${port} after ${maxAttempts} attempts`));
        setTimeout(check, 150);
      });
      req.end();
    };
    check();
  });
}

function spawnWorker(cacheDir, port, envOverrides = {}) {
  // Point both cacheDir and workerDir at the same temp directory so the test
  // never touches the user's real home (~/.jarvis-cache/worker) and assertions
  // can use cacheDir for both vault and worker-owned files.
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19999',
    CLAUDE_PLUGIN_OPTION_APIKEY: 'test-key',
    CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
    CLAUDE_PLUGIN_OPTION_WORKERDIR: cacheDir,
    CLAUDE_PLUGIN_OPTION_WORKERPORT: String(port),
    ...envOverrides,
  };
  return spawn('node', [SERVER_SCRIPT], { env, stdio: 'pipe' });
}

function killAndWait(child, timeout = 3000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      setTimeout(resolve, 200);
    }, timeout);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
    try {
      process.kill(child.pid, 'SIGINT');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
  });
}

describe('worker/server', () => {
  let cacheDir;
  let workerPort;
  let children = [];

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'jarvis-worker-test-'));
    workerPort = portCounter++;
  });

  afterEach(async () => {
    for (const child of children) {
      await killAndWait(child);
    }
    children = [];
    await new Promise(resolve => setTimeout(resolve, 300));
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function startWorker(envOverrides = {}) {
    const child = spawnWorker(cacheDir, workerPort, envOverrides);
    children.push(child);
    await waitForServer(workerPort);
    return child;
  }

  it('should return a populated payload with status ok when GET /health is called', async () => {
    // Arrange
    await startWorker();

    // Act
    const res = await request(workerPort, 'GET', '/health');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      cacheDir,
      lastManifestHash: null,
      fileCount: 0,
    });
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
    expect(typeof res.body.pluginRoot).toBe('string');
    expect(res.body.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.idleShutdownAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should write a startup log line to <cacheDir>/logs/worker.log when worker boots', async () => {
    // Arrange
    await startWorker();

    // Act
    const logFile = join(cacheDir, 'logs', 'worker.log');
    const contents = readFileSync(logFile, 'utf8');

    // Assert
    expect(existsSync(logFile)).toBe(true);
    expect(contents).toContain('jarvis.worker.started');
  });

  it('should exit cleanly when idle window elapses with no successful drains', async () => {
    // Arrange
    const child = spawnWorker(cacheDir, workerPort, {
      CLAUDE_PLUGIN_OPTION_IDLEMS: '500',
      CLAUDE_PLUGIN_OPTION_IDLECHECKMS: '200',
    });
    children.push(child);
    await waitForServer(workerPort);

    // Act
    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 4000);
      if (child.exitCode !== null) {
        clearTimeout(timer);
        resolve(child.exitCode);
        return;
      }
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });

    // Assert
    expect(exitCode).toBe(0);
  }, 8000);

  it('should trigger sync and return result when POST /sync is called', async () => {
    // Arrange
    await startWorker();

    // Act
    const res = await request(workerPort, 'POST', '/sync');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(false);
    expect(res.body.reason).toBe('error');
  });

  it('should write the PID file when worker starts', async () => {
    // Arrange
    const child = await startWorker();

    // Act
    const pidFile = join(cacheDir, '.worker.pid');
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);

    // Assert
    expect(existsSync(pidFile)).toBe(true);
    expect(pid).toBe(child.pid);
  });

  it('should clean up the PID file when worker shuts down (Unix) or exit cleanly (Windows)', async () => {
    // Arrange
    const child = await startWorker();
    const pidFile = join(cacheDir, '.worker.pid');
    expect(existsSync(pidFile)).toBe(true);

    // Act
    await killAndWait(child);
    children = children.filter(c => c !== child);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Assert
    if (process.platform !== 'win32') {
      expect(existsSync(pidFile)).toBe(false);
    }
    expect(child.exitCode).not.toBeNull();
  });

  it('should exit 0 when EADDRINUSE occurs on startup', async () => {
    // Arrange
    const blocker = http.createServer((req, res) => { res.end('ok'); });
    await new Promise(resolve => blocker.listen(workerPort, resolve));

    try {
      // Act
      const child = spawnWorker(cacheDir, workerPort);
      children.push(child);
      const exitCode = await new Promise(resolve => child.on('exit', resolve));

      // Assert
      expect(exitCode).toBe(0);
    } finally {
      await new Promise(resolve => blocker.close(resolve));
    }
  });

  it('should return 404 when an unknown route is requested', async () => {
    // Arrange
    await startWorker();

    // Act
    const res = await request(workerPort, 'GET', '/unknown');

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('should exit 1 when CLAUDE_PLUGIN_OPTION_APIKEY is missing', async () => {
    // Arrange
    const env = {
      CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19999',
      CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
      CLAUDE_PLUGIN_OPTION_WORKERPORT: String(workerPort),
    };
    const cleanEnv = { ...process.env, ...env };
    delete cleanEnv.CLAUDE_PLUGIN_OPTION_APIKEY;

    // Act
    const child = spawn('node', [SERVER_SCRIPT], { env: cleanEnv, stdio: 'pipe' });
    children.push(child);
    const exitCode = await new Promise(resolve => child.on('exit', resolve));

    // Assert
    expect(exitCode).toBe(1);
  });
});
