import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = join(__dirname, '..', '..', 'worker', 'server.js');

// Each test gets a unique port via incrementing counter to avoid conflicts
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
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19999',
    CLAUDE_PLUGIN_OPTION_APIKEY: 'test-key',
    CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
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
    // On Windows, SIGTERM doesn't trigger signal handlers in child Node processes.
    // Use process.kill with SIGINT which sends CTRL_C_EVENT on Windows.
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
    // Kill all spawned children
    for (const child of children) {
      await killAndWait(child);
    }
    children = [];
    // Wait for port release on Windows
    await new Promise(resolve => setTimeout(resolve, 300));
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function startWorker(envOverrides = {}) {
    const child = spawnWorker(cacheDir, workerPort, envOverrides);
    children.push(child);
    await waitForServer(workerPort);
    return child;
  }

  it('GET /health returns correct structure with status ok', async () => {
    await startWorker();

    const res = await request(workerPort, 'GET', '/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('lastSync');
    expect(res.body).toHaveProperty('lastManifestHash');
    expect(res.body).toHaveProperty('fileCount');
    expect(res.body).toHaveProperty('cacheDir', cacheDir);
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version).not.toBe('');
    expect(res.body).toHaveProperty('pluginRoot');
    expect(res.body).toHaveProperty('lastDrain');
    expect(res.body).toHaveProperty('lastDrainResult');
  });

  it('POST /sync triggers sync and returns result', async () => {
    await startWorker();

    const res = await request(workerPort, 'POST', '/sync');

    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(false);
    expect(res.body.reason).toBe('error');
  });

  it('writes PID file on startup', async () => {
    const child = await startWorker();

    const pidFile = join(cacheDir, '.worker.pid');
    expect(existsSync(pidFile)).toBe(true);

    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    expect(pid).toBe(child.pid);
  });

  it('cleans up PID file on shutdown (Unix) or exits cleanly (Windows)', async () => {
    const child = await startWorker();

    const pidFile = join(cacheDir, '.worker.pid');
    expect(existsSync(pidFile)).toBe(true);

    await killAndWait(child);
    // Remove from children list since already killed
    children = children.filter(c => c !== child);
    await new Promise(resolve => setTimeout(resolve, 300));

    if (process.platform !== 'win32') {
      expect(existsSync(pidFile)).toBe(false);
    }
    // Process exited
    expect(child.exitCode).not.toBeNull();
  });

  it('EADDRINUSE is handled gracefully (exits 0)', async () => {
    const blocker = http.createServer((req, res) => { res.end('ok'); });
    await new Promise(resolve => blocker.listen(workerPort, resolve));

    try {
      const child = spawnWorker(cacheDir, workerPort);
      children.push(child);
      const exitCode = await new Promise(resolve => child.on('exit', resolve));
      expect(exitCode).toBe(0);
    } finally {
      await new Promise(resolve => blocker.close(resolve));
    }
  });

  it('returns 404 for unknown routes', async () => {
    await startWorker();

    const res = await request(workerPort, 'GET', '/unknown');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('exits with 1 when API key is missing', async () => {
    const env = {
      CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19999',
      CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
      CLAUDE_PLUGIN_OPTION_WORKERPORT: String(workerPort),
    };
    // Create a clean env without apiKey
    const cleanEnv = { ...process.env, ...env };
    delete cleanEnv.CLAUDE_PLUGIN_OPTION_APIKEY;

    const child = spawn('node', [SERVER_SCRIPT], { env: cleanEnv, stdio: 'pipe' });
    children.push(child);
    const exitCode = await new Promise(resolve => child.on('exit', resolve));
    expect(exitCode).toBe(1);
  });
});
