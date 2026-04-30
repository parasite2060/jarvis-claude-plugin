import http from 'node:http';
import { mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { syncFiles } from './file-sync.js';
import { drainConversations } from './conversation-drain.js';

function resolveHome(p) {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');

function readPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const PLUGIN_VERSION = readPluginVersion();
const SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_SERVERURL || 'http://localhost:8000';
const API_KEY = process.env.CLAUDE_PLUGIN_OPTION_APIKEY;
const CACHE_DIR = resolveHome(process.env.CLAUDE_PLUGIN_OPTION_CACHEDIR || '~/.jarvis-cache/ai-memory');
const WORKER_PORT = Number(process.env.CLAUDE_PLUGIN_OPTION_WORKERPORT) || 37777;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DRAIN_INTERVAL_MS = 30 * 1000;

function parseExtraHeaders() {
  const raw = process.env.CLAUDE_PLUGIN_OPTION_EXTRAHEADERS || '';
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

let lastDrain = null;
let lastDrainResult = null;
let drainInProgress = false;

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

async function runDrain() {
  if (drainInProgress) return;
  drainInProgress = true;
  try {
    const result = await drainConversations({
      serverUrl: SERVER_URL,
      apiKey: API_KEY,
      cacheDir: CACHE_DIR,
      extraHeaders: EXTRA_HEADERS,
    });
    lastDrain = new Date().toISOString();
    lastDrainResult = result;
    return result;
  } finally {
    drainInProgress = false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      version: PLUGIN_VERSION,
      pluginRoot: PLUGIN_ROOT,
      lastSync,
      lastManifestHash,
      fileCount,
      lastDrain,
      lastDrainResult,
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

  if (req.method === 'POST' && req.url === '/drain') {
    const result = await runDrain();
    res.writeHead(200);
    res.end(JSON.stringify(result ?? { status: 'in-progress' }));
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

let syncTimer = null;
let drainTimer = null;

function shutdown() {
  if (syncTimer) clearInterval(syncTimer);
  if (drainTimer) clearInterval(drainTimer);
  server.close(() => {});
  cleanupPid();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
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
  console.error(`jarvis.worker.started: version=${PLUGIN_VERSION} port=${WORKER_PORT} cacheDir=${CACHE_DIR}`);
  // Wrap setInterval callbacks so an unhandled rejection from runSync/runDrain
  // does not crash the worker (Node ≥15 default).
  runSync().catch((err) => console.error(`jarvis.worker.sync-error: ${err.message}`));
  runDrain().catch((err) => console.error(`jarvis.worker.drain-error: ${err.message}`));
  syncTimer = setInterval(() => {
    runSync().catch((err) => console.error(`jarvis.worker.sync-error: ${err.message}`));
  }, SYNC_INTERVAL_MS);
  drainTimer = setInterval(() => {
    runDrain().catch((err) => console.error(`jarvis.worker.drain-error: ${err.message}`));
  }, DRAIN_INTERVAL_MS);
});
