import {
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { STDERR_FALLBACK_LOGGER } from './lib/fallback-logger.js';

const QUEUE_DIRNAME = 'pending-conversations';
const FAILED_DIRNAME = '.failed';
const OVERLAP_LINES = 20;
const DEFAULT_FETCH_TIMEOUT_MS = 180_000;

const DEFAULT_MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
const SIDECAR_SUFFIX = '.attempts';

// Module-scope auth-block state. In-memory only — a worker restart clears it
// and the next drain tick re-detects on a 401/403. Story 12.4 AC 8–14.
let authBlocked = false;
let authBlockedReason = null;
let authBlockLogged = false;

function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}

// Strip basic-auth credentials (and any query string) from URLs before they
// land in log files. If the input isn't parseable as a URL, return as-is.
function sanitizeUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const u = new URL(value);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

// Best-effort scrub of any URL substrings inside a free-form error message.
function sanitizeMessage(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/https?:\/\/\S+/g, (match) => sanitizeUrl(match));
}

// Walks one level of err.cause so log lines surface the actual syscall
// (ECONNREFUSED, EAI_AGAIN, ...) that the high-level fetch() error wraps.
function errCauseSummary(err) {
  const cause = err && err.cause;
  if (!cause) return 'none';
  const name = cause.name || 'Error';
  const code = cause.code ? ` code=${cause.code}` : '';
  const message = cause.message
    ? ` message=${JSON.stringify(sanitizeMessage(String(cause.message)))}`
    : '';
  return `${name}${code}${message}`;
}

function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function queueDir(workerDir) {
  return join(workerDir, QUEUE_DIRNAME);
}

function failedDir(workerDir) {
  return join(workerDir, QUEUE_DIRNAME, FAILED_DIRNAME);
}

function listQueueFiles(workerDir) {
  try {
    return readdirSync(queueDir(workerDir))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

function payloadKB(fullPath) {
  try {
    return Math.round(statSync(fullPath).size / 1024);
  } catch {
    return 0;
  }
}

// Per-file retry budget — sidecar attempt counter (story 12.4 AC 1–7).
function backoffMs(attempts) {
  if (attempts <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * (2 ** (attempts - 1)), BACKOFF_CAP_MS);
}

function sidecarPath(workerDir, filename) {
  return join(queueDir(workerDir), filename + SIDECAR_SUFFIX);
}

function readAttempts(workerDir, filename) {
  try {
    const sp = sidecarPath(workerDir, filename);
    const stat = statSync(sp);
    const count = parseInt(readFileSync(sp, 'utf8'), 10);
    return { count: Number.isFinite(count) ? count : 0, mtimeMs: stat.mtimeMs };
  } catch {
    return { count: 0, mtimeMs: 0 };
  }
}

// Atomic write — temp file + rename, so a torn read can never observe a
// partial integer.
function writeAttempts(workerDir, filename, n) {
  const sp = sidecarPath(workerDir, filename);
  const tmp = sp + '.tmp';
  writeFileSync(tmp, String(n), 'utf8');
  renameSync(tmp, sp);
}

function clearAttempts(workerDir, filename) {
  try { unlinkSync(sidecarPath(workerDir, filename)); } catch { /* may be gone */ }
}

// Drop *.json.attempts files whose matching *.json no longer exists.
// Quiet — no log unless an unexpected error escapes.
function sweepOrphanSidecars(workerDir) {
  let entries;
  try {
    entries = readdirSync(queueDir(workerDir));
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(SIDECAR_SUFFIX)) continue;
    const queueName = name.slice(0, -SIDECAR_SUFFIX.length);
    if (existsSync(join(queueDir(workerDir), queueName))) continue;
    try { unlinkSync(join(queueDir(workerDir), name)); } catch { /* tolerate ENOENT */ }
  }
}

async function fetchLastPosition(serverUrl, headers, sessionId, timeoutMs, logger) {
  try {
    const url = `${serverUrl}/conversations/position?session_id=${encodeURIComponent(sessionId)}`;
    const res = await fetchWithTimeout(url, { headers }, timeoutMs);
    if (res.status === 401 || res.status === 403) {
      setAuthBlocked(String(res.status), serverUrl, logger);
      return 0;
    }
    if (!res.ok) return 0;
    const body = await res.json();
    return typeof body?.last_line === 'number' ? body.last_line : 0;
  } catch {
    return 0;
  }
}

function extractSegment(fullContent, lastLine) {
  const lines = fullContent.split('\n');
  const totalLines = lines.length;
  if (lastLine === 0 || lastLine >= totalLines) {
    return { content: fullContent, startLine: 0, endLine: totalLines };
  }
  const startLine = Math.max(0, lastLine - OVERLAP_LINES);
  return { content: lines.slice(startLine).join('\n'), startLine, endLine: totalLines };
}

// 408/429 are transient per RFC; 401/403 (auth) and other 4xx are non-retryable.
function isRetryable(status) {
  if (status === 401 || status === 403) return false;
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

function moveToFailed(workerDir, filename, reason, logger) {
  try {
    mkdirSync(failedDir(workerDir), { recursive: true });
    renameSync(join(queueDir(workerDir), filename), join(failedDir(workerDir), filename));
    logger.warn(`jarvis.drain.failed-moved: ${filename} reason=${reason}`);
  } catch (err) {
    logger.error(`jarvis.drain.failed-move-error: ${filename} ${errMsg(err)}`);
  }
}

function loadPayload(fullPath) {
  try {
    const payload = JSON.parse(readFileSync(fullPath, 'utf8'));
    if (!payload.sessionId || typeof payload.filteredTranscript !== 'string') {
      return { error: 'malformed:missing-fields' };
    }
    return { payload };
  } catch (err) {
    return { error: `parse:${errMsg(err)}` };
  }
}

function buildHeaders(apiKey, extraHeaders) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...extraHeaders,
  };
}

async function postSegment(serverUrl, headers, payload, segment, timeoutMs) {
  return fetchWithTimeout(`${serverUrl}/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId: payload.sessionId,
      transcript: segment.content,
      source: payload.source || 'stop',
      segmentStartLine: segment.startLine,
      segmentEndLine: segment.endLine,
    }),
  }, timeoutMs);
}

// Latches the auth-block flag and logs once per block. Subsequent calls while
// the flag is set with a logged reason are no-ops.
function setAuthBlocked(reason, serverUrl, logger) {
  if (authBlocked && authBlockLogged) return;
  authBlocked = true;
  authBlockedReason = reason;
  if (!authBlockLogged) {
    logger.warn(
      `jarvis.drain.auth-blocked: status=${reason} serverUrl=${sanitizeUrl(serverUrl)}`,
    );
    authBlockLogged = true;
  }
}

export function getAuthState() {
  return { authBlocked, authBlockedReason };
}

export function clearAuthBlock() {
  authBlocked = false;
  authBlockedReason = null;
  authBlockLogged = false;
}

async function drainOne(filename, { serverUrl, apiKey, workerDir, extraHeaders, fetchTimeoutMs, logger }) {
  const fullPath = join(queueDir(workerDir), filename);
  const sizeKB = payloadKB(fullPath);
  const url = sanitizeUrl(`${serverUrl}/conversations`);

  // Backoff gate — if the sidecar exists and we are still inside the backoff
  // window, skip without touching the file (so mtime stays at last-attempt).
  const { count: priorAttempts, mtimeMs } = readAttempts(workerDir, filename);
  if (priorAttempts > 0 && Date.now() < mtimeMs + backoffMs(priorAttempts)) {
    return { status: 'retry-skipped' };
  }

  const { payload, error } = loadPayload(fullPath);
  if (error) {
    moveToFailed(workerDir, filename, error, logger);
    clearAttempts(workerDir, filename);
    return { status: 'failed' };
  }

  const headers = buildHeaders(apiKey, extraHeaders);
  const lastLine = await fetchLastPosition(serverUrl, headers, payload.sessionId, fetchTimeoutMs, logger);
  const segment = extractSegment(payload.filteredTranscript, lastLine);

  const startedAt = performance.now();
  let res;
  try {
    res = await postSegment(serverUrl, headers, payload, segment, fetchTimeoutMs);
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const name = err && err.name ? err.name : 'Error';
    logger.warn(
      `jarvis.drain.network-error: ${filename} url=${url} payloadKB=${sizeKB} ` +
      `elapsedMs=${elapsedMs} err=${name} cause=${errCauseSummary(err)} ` +
      `message=${JSON.stringify(sanitizeMessage(errMsg(err)))}`,
    );
    return recordRetryable(workerDir, filename, priorAttempts, name, logger);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);

  if (res.ok) {
    logger.info(
      `jarvis.drain.sent: ${filename} sessionId=${payload.sessionId} ` +
      `startLine=${segment.startLine} endLine=${segment.endLine} ` +
      `elapsedMs=${elapsedMs} payloadKB=${sizeKB}`,
    );
    try { unlinkSync(fullPath); } catch { /* file may already be gone */ }
    clearAttempts(workerDir, filename);
    return { status: 'sent' };
  }

  if (res.status === 401 || res.status === 403) {
    setAuthBlocked(String(res.status), serverUrl, logger);
    moveToFailed(
      workerDir,
      filename,
      `auth-blocked status=${res.status} url=${url} payloadKB=${sizeKB} elapsedMs=${elapsedMs}`,
      logger,
    );
    clearAttempts(workerDir, filename);
    return { status: 'failed' };
  }

  if (isRetryable(res.status)) {
    logger.warn(
      `jarvis.drain.retryable: ${filename} url=${url} status=${res.status} ` +
      `payloadKB=${sizeKB} elapsedMs=${elapsedMs}`,
    );
    return recordRetryable(workerDir, filename, priorAttempts, `http:${res.status}`, logger);
  }

  moveToFailed(
    workerDir,
    filename,
    `http:${res.status} url=${url} payloadKB=${sizeKB} elapsedMs=${elapsedMs}`,
    logger,
  );
  clearAttempts(workerDir, filename);
  return { status: 'failed' };
}

// Increments the sidecar attempt counter; if the budget is exhausted, moves
// the file to .failed/ with a retry-budget-exhausted reason.
function recordRetryable(workerDir, filename, priorAttempts, lastStatus, logger) {
  const next = priorAttempts + 1;
  if (next >= DEFAULT_MAX_ATTEMPTS) {
    moveToFailed(
      workerDir,
      filename,
      `retry-budget-exhausted attempts=${next} lastStatus=${lastStatus}`,
      logger,
    );
    clearAttempts(workerDir, filename);
    return { status: 'failed' };
  }
  try {
    writeAttempts(workerDir, filename, next);
  } catch (err) {
    logger.warn(`jarvis.drain.sidecar-write-error: ${filename} ${errMsg(err)}`);
  }
  return { status: 'retry' };
}

export async function drainConversations({ serverUrl, apiKey, workerDir, extraHeaders = {}, fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS, logger = STDERR_FALLBACK_LOGGER }) {
  if (!apiKey) return { sent: 0, failed: 0, retried: 0, skipped: 'no-api-key' };
  if (authBlocked) return { sent: 0, failed: 0, retried: 0, skipped: 'auth-blocked' };

  sweepOrphanSidecars(workerDir);

  const files = listQueueFiles(workerDir);
  if (files.length === 0) return { sent: 0, failed: 0, retried: 0 };

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const filename of files) {
    const result = await drainOne(filename, { serverUrl, apiKey, workerDir, extraHeaders, fetchTimeoutMs, logger });
    if (result.status === 'sent') sent++;
    else if (result.status === 'failed') failed++;
    else retried++;
  }

  return { sent, failed, retried };
}

export { QUEUE_DIRNAME };
