/**
 * Manages the local background file sync worker lifecycle.
 * Checks health, handles stale PID files, spawns worker if needed.
 * Never throws — all errors caught internally.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './jarvis-client.js';

function resolveHome(p) {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

const WORKER_PORT = config.workerPort;
const CACHE_DIR = resolveHome(config.cacheDir);

function getPidFilePath() {
  return join(CACHE_DIR, '.worker.pid');
}

async function isWorkerHealthy() {
  try {
    const res = await fetch(`http://localhost:${WORKER_PORT}/health`);
    return res.ok;
  } catch {
    return false;
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

export async function ensureWorkerRunning() {
  try {
    if (await isWorkerHealthy()) return;

    const pidFile = getPidFilePath();
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (!isNaN(pid) && isProcessAlive(pid)) return;
      try { unlinkSync(pidFile); } catch { /* ignore */ }
    }

    mkdirSync(CACHE_DIR, { recursive: true });

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const workerScript = join(__dirname, '..', '..', 'worker', 'server.js');

    // Pass config to worker via env vars (worker reads CLAUDE_PLUGIN_OPTION_*)
    const child = spawn('node', [workerScript], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_OPTION_serverUrl: config.serverUrl,
        CLAUDE_PLUGIN_OPTION_apiKey: config.apiKey,
        CLAUDE_PLUGIN_OPTION_cacheDir: config.cacheDir,
        CLAUDE_PLUGIN_OPTION_workerPort: String(config.workerPort),
        CLAUDE_PLUGIN_OPTION_extraHeaders: config.extraHeaders,
      },
    });
    child.unref();

    if (child.pid) {
      writeFileSync(pidFile, String(child.pid), 'utf8');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.worker-manager.error: ${message}`);
  }
}
