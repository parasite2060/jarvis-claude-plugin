import http from 'node:http';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { syncFiles } from './file-sync.js';
import { drainConversations } from './conversation-drain.js';
import { createLogger } from './lib/logger.js';
import { loadWorkerConfig } from './lib/config.js';
import { migrateLegacyWorkspace } from './lib/migrate-workspace.js';
import { sweepOrphanTmpFiles } from './lib/tmp-sweep.js';

const config = loadWorkerConfig();

mkdirSync(config.cacheDir, { recursive: true });
mkdirSync(config.workerDir, { recursive: true });

// Run migration before the logger so the first log line lands in the new
// location. Safe to call on every boot — idempotent and never overwrites.
migrateLegacyWorkspace({ cacheDir: config.cacheDir, workerDir: config.workerDir });

const PID_FILE = join(config.workerDir, '.worker.pid');
const logger = createLogger({ dir: join(config.workerDir, 'logs') });

if (!config.apiKey) {
  logger.error('jarvis.worker.startup-failed: CLAUDE_PLUGIN_OPTION_apiKey is required');
  process.exit(1);
}

function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}

// Module-level mutable state for periodic background work and the /health view.
// Use a monotonic clock for idle math so NTP corrections, laptop sleep, or
// daylight-saving jumps don't trigger a spurious shutdown (or delay one).
// Date.now() is kept only for the user-visible /health timestamps.
const state = {
  lastSync: null,
  lastManifestHash: null,
  fileCount: 0,
  lastDrain: null,
  lastDrainResult: null,
  lastActivityAtMono: performance.now(),
  lastActivityAtWall: Date.now(),
};

function recordActivity() {
  state.lastActivityAtMono = performance.now();
  state.lastActivityAtWall = Date.now();
}

// Single-flight guard: skips re-entry if the same task is still running.
function singleFlight(fn) {
  let inProgress = false;
  return async function guarded() {
    if (inProgress) return;
    inProgress = true;
    try { return await fn(); } finally { inProgress = false; }
  };
}

const runSync = singleFlight(async function runSyncBody() {
  const result = await syncFiles(config.serverUrl, config.apiKey, config.cacheDir, config.extraHeaders, logger);
  if (result.synced) {
    state.lastSync = new Date().toISOString();
    state.lastManifestHash = result.manifestHash;
    state.fileCount = result.fileCount ?? state.fileCount;
  } else if (result.reason === 'no-changes') {
    state.lastSync = new Date().toISOString();
  }
  return result;
});

const runDrain = singleFlight(async function runDrainBody() {
  const result = await drainConversations({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
    workerDir: config.workerDir,
    extraHeaders: config.extraHeaders,
    fetchTimeoutMs: config.fetchTimeoutMs,
    logger,
  });
  state.lastDrain = new Date().toISOString();
  state.lastDrainResult = result;
  if (result?.sent > 0) recordActivity();
  return result;
});

function buildHealthPayload() {
  return {
    status: 'ok',
    version: config.pluginVersion,
    pluginRoot: config.pluginRoot,
    lastSync: state.lastSync,
    lastManifestHash: state.lastManifestHash,
    fileCount: state.fileCount,
    lastDrain: state.lastDrain,
    lastDrainResult: state.lastDrainResult,
    lastActivityAt: new Date(state.lastActivityAtWall).toISOString(),
    idleShutdownAt: new Date(state.lastActivityAtWall + config.idleTimeoutMs).toISOString(),
    cacheDir: config.cacheDir,
    workerDir: config.workerDir,
  };
}

function sendJson(res, status, body) {
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

const ROUTES = {
  'GET /health': async () => buildHealthPayload(),
  'POST /sync':  async () => runSync(),
  'POST /drain': async () => (await runDrain()) ?? { status: 'in-progress' },
};

async function dispatchRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const handler = ROUTES[`${req.method} ${req.url}`];
  if (!handler) return sendJson(res, 404, { error: 'Not found' });
  return sendJson(res, 200, await handler());
}

const server = http.createServer(dispatchRequest);

function writePid() {
  try {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (err) {
    logger.error(`jarvis.worker.pid-write-failed: ${errMsg(err)}`);
  }
}

function cleanupPid() {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

const timers = { sync: null, drain: null, idle: null };
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const timer of Object.values(timers)) {
    if (timer) clearInterval(timer);
  }
  server.close(() => {});
  cleanupPid();
  process.exit(0);
}

function checkIdle() {
  if (shuttingDown) return;
  const idleMs = performance.now() - state.lastActivityAtMono;
  if (idleMs <= config.idleTimeoutMs) return;
  logger.info(`jarvis.worker.idle-shutdown: lastActivityAt=${new Date(state.lastActivityAtWall).toISOString()} thresholdMs=${config.idleTimeoutMs}`);
  shutdown();
}

// Wraps async work so an unhandled rejection from the background timers
// does not crash the worker (Node ≥15 default).
function runGuarded(name, fn) {
  fn().catch((err) => logger.error(`jarvis.worker.${name}-error: ${errMsg(err)}`));
}

function scheduleEvery(intervalMs, name, fn) {
  return setInterval(() => runGuarded(name, fn), intervalMs);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', cleanupPid);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`jarvis.worker.port-in-use: port ${config.workerPort} already in use, another worker is running`);
    process.exit(0);
  }
  logger.error(`jarvis.worker.server-error: ${err.message}`);
});

// Best-effort orphan sweep before opening the listener. Wrapped so a sweep
// fault (unexpected throw past the helper's own guards) never blocks startup.
try {
  sweepOrphanTmpFiles({ workerDir: config.workerDir, logger });
} catch (err) {
  logger.warn(`jarvis.worker.tmp-sweep-failed: ${errMsg(err)}`);
}

server.listen(config.workerPort, '127.0.0.1', () => {
  writePid();
  logger.info(`jarvis.worker.started: version=${config.pluginVersion} host=127.0.0.1 port=${config.workerPort} cacheDir=${config.cacheDir} workerDir=${config.workerDir} idleMs=${config.idleTimeoutMs}`);
  runGuarded('sync', runSync);
  runGuarded('drain', runDrain);
  timers.sync = scheduleEvery(config.syncIntervalMs, 'sync', runSync);
  timers.drain = scheduleEvery(config.drainIntervalMs, 'drain', runDrain);
  timers.idle = setInterval(checkIdle, config.idleCheckIntervalMs);
});
