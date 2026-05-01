/**
 * Manages the local background worker lifecycle.
 * - Spawns worker if not running.
 * - Compares running worker version against on-disk plugin version, restarts on mismatch.
 *   Without this check, plugin upgrades leave the old worker running indefinitely
 *   because /health succeeds and the PID is alive.
 * Never throws — all errors caught internally.
 *
 * Logging: this module runs in the *hook* process and writes to stderr, which
 * Claude Code captures and surfaces in its hook diagnostics. The worker process
 * has its own structured log at <cacheDir>/logs/worker.log. They are kept
 * separate by design — they reflect different lifecycles and audiences.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { config } from './jarvis-client.js';
import { resolveHome } from '../../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..');

function readPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const WORKER_PORT = config.workerPort;
const CACHE_DIR = resolveHome(config.cacheDir);
const WORKER_DIR = resolveHome(config.workerDir);
const PLUGIN_VERSION = readPluginVersion();
const PORT_FREE_POLL_MS = 100;
const PORT_FREE_TIMEOUT_MS = 2000;

function getPidFilePath() {
  return join(WORKER_DIR, '.worker.pid');
}

async function fetchHealth() {
  try {
    const res = await fetch(`http://localhost:${WORKER_PORT}/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortFree() {
  // ECONNREFUSED is the only response that proves nobody is listening. Any other
  // outcome (timeout, network error, success) is treated as "not free" — destroy
  // the socket either way to avoid leaking handles inside the polling loop.
  return new Promise((resolve) => {
    const sock = createConnection({ port: WORKER_PORT, host: '127.0.0.1' });
    sock.setTimeout(200);
    const settle = (free) => { sock.destroy(); resolve(free); };
    sock.once('connect', () => settle(false));
    sock.once('timeout', () => settle(false));
    sock.once('error', (err) => settle(err.code === 'ECONNREFUSED'));
  });
}

async function waitForPortFree() {
  const deadline = Date.now() + PORT_FREE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isPortFree()) return true;
    await new Promise((r) => setTimeout(r, PORT_FREE_POLL_MS));
  }
  return false;
}

function readPid() {
  // Reject pid <= 0: process.kill(0, ...) signals the entire process group
  // (would SIGTERM Claude Code itself), and negative pids broadcast across
  // the user's processes.
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (Number.isNaN(pid) || pid <= 0) return null;
  return pid;
}

async function terminateWorker(pid, reason) {
  console.error(`jarvis.worker-manager.terminating: pid=${pid} reason=${reason}`);
  try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }

  if (await waitForPortFree()) return true;

  console.error(`jarvis.worker-manager.sigkill: pid=${pid} port still bound after ${PORT_FREE_TIMEOUT_MS}ms`);
  try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  return await waitForPortFree();
}

function spawnWorker() {
  // Ensure both directories exist so the PID file write below and the worker's
  // own startup don't race on missing parents.
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(WORKER_DIR, { recursive: true });
  const workerScript = join(PLUGIN_ROOT, 'worker', 'server.js');

  const child = spawn('node', [workerScript], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_OPTION_SERVERURL: config.serverUrl,
      CLAUDE_PLUGIN_OPTION_APIKEY: config.apiKey,
      CLAUDE_PLUGIN_OPTION_CACHEDIR: config.cacheDir,
      CLAUDE_PLUGIN_OPTION_WORKERDIR: config.workerDir,
      CLAUDE_PLUGIN_OPTION_WORKERPORT: String(config.workerPort),
      CLAUDE_PLUGIN_OPTION_EXTRAHEADERS: config.extraHeaders || '',
      CLAUDE_PLUGIN_OPTION_FETCHTIMEOUTMS: String(config.fetchTimeoutMs ?? 180_000),
    },
  });
  // Without an error listener, a synchronous spawn failure (ENOENT, EACCES)
  // emits 'error' on an EventEmitter with no handler — fatal to the hook.
  child.on('error', (err) => {
    console.error(`jarvis.worker-manager.spawn-error: ${err.message}`);
  });
  child.unref();

  if (child.pid) {
    writeFileSync(getPidFilePath(), String(child.pid), 'utf8');
  }
}

function isVersionMatch(reportedVersion) {
  // 'unknown' on either side cannot prove a match — treat as mismatch so a
  // broken package.json on the running worker forces a restart instead of a
  // silent stale-version state.
  if (!reportedVersion || reportedVersion === 'unknown') return false;
  if (PLUGIN_VERSION === 'unknown') return false;
  return reportedVersion === PLUGIN_VERSION;
}

export async function ensureWorkerRunning() {
  try {
    const health = await fetchHealth();

    if (health) {
      if (isVersionMatch(health.version)) return;
      const pid = readPid();
      if (pid && isProcessAlive(pid)) {
        await terminateWorker(pid, `version-mismatch running=${health.version} expected=${PLUGIN_VERSION}`);
      }
    } else {
      const pid = readPid();
      if (pid && isProcessAlive(pid)) {
        await terminateWorker(pid, 'health-unreachable');
      } else if (pid) {
        try { unlinkSync(getPidFilePath()); } catch { /* ignore */ }
      }
    }

    // Always clear the PID file before spawn — if terminate failed to free the
    // port, the new child will exit on EADDRINUSE and we want the next session
    // to retry from a clean slate rather than trust a misleading PID.
    try { unlinkSync(getPidFilePath()); } catch { /* ignore */ }
    spawnWorker();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.worker-manager.error: ${message}`);
  }
}
