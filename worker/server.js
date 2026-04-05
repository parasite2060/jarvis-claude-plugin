import http from 'node:http';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { syncFiles } from './file-sync.js';

function resolveHome(p) {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

const SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_serverUrl || 'http://localhost:8000';
const API_KEY = process.env.CLAUDE_PLUGIN_OPTION_apiKey;
const CACHE_DIR = resolveHome(process.env.CLAUDE_PLUGIN_OPTION_cacheDir || '~/.jarvis-cache/ai-memory');
const WORKER_PORT = Number(process.env.CLAUDE_PLUGIN_OPTION_workerPort) || 37777;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

function parseExtraHeaders() {
  const raw = process.env.CLAUDE_PLUGIN_OPTION_extraHeaders || '';
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch { return {}; }
}
const EXTRA_HEADERS = parseExtraHeaders();

if (!API_KEY) {
  console.error('jarvis.worker.startup-failed: CLAUDE_PLUGIN_OPTION_apiKey is required');
  process.exit(1);
}

mkdirSync(CACHE_DIR, { recursive: true });

const PID_FILE = join(CACHE_DIR, '.worker.pid');

let lastSync = null;
let lastManifestHash = null;
let fileCount = 0;
let syncInProgress = false;

async function runSync() {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    const result = await syncFiles(SERVER_URL, API_KEY, CACHE_DIR, EXTRA_HEADERS);
    if (result.synced) {
      lastSync = new Date().toISOString();
      lastManifestHash = result.manifestHash;
      fileCount = result.fileCount ?? fileCount;
    } else if (result.reason === 'no-changes') {
      lastSync = new Date().toISOString();
    }
    return result;
  } finally {
    syncInProgress = false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      lastSync,
      lastManifestHash,
      fileCount,
      cacheDir: CACHE_DIR,
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/sync') {
    const result = await runSync();
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

function writePid() {
  try {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.worker.pid-write-failed: ${msg}`);
  }
}

function cleanupPid() {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // best-effort
  }
}

process.on('SIGINT', () => { cleanupPid(); process.exit(0); });
process.on('SIGTERM', () => { cleanupPid(); process.exit(0); });
process.on('exit', () => { cleanupPid(); });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`jarvis.worker.port-in-use: port ${WORKER_PORT} already in use, another worker is running`);
    process.exit(0);
  }
  console.error(`jarvis.worker.server-error: ${err.message}`);
});

server.listen(WORKER_PORT, () => {
  writePid();
  console.error(`jarvis.worker.started: listening on port ${WORKER_PORT}, cacheDir=${CACHE_DIR}`);
  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
});
