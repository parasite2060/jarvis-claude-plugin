import { readdirSync, readFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { STDERR_FALLBACK_LOGGER } from './lib/fallback-logger.js';

const QUEUE_DIRNAME = 'pending-conversations';
const FAILED_DIRNAME = '.failed';
const OVERLAP_LINES = 20;
const FETCH_TIMEOUT_MS = 180_000;

function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}

function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function queueDir(cacheDir) {
  return join(cacheDir, QUEUE_DIRNAME);
}

function failedDir(cacheDir) {
  return join(cacheDir, QUEUE_DIRNAME, FAILED_DIRNAME);
}

function listQueueFiles(cacheDir) {
  try {
    return readdirSync(queueDir(cacheDir))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

async function fetchLastPosition(serverUrl, headers, sessionId) {
  try {
    const url = `${serverUrl}/conversations/position?session_id=${encodeURIComponent(sessionId)}`;
    const res = await fetchWithTimeout(url, { headers });
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

// 408/429 are transient per RFC; everything else 4xx is non-retryable.
function isRetryable(status) {
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

function moveToFailed(cacheDir, filename, reason, logger) {
  try {
    mkdirSync(failedDir(cacheDir), { recursive: true });
    renameSync(join(queueDir(cacheDir), filename), join(failedDir(cacheDir), filename));
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

async function postSegment(serverUrl, headers, payload, segment) {
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
  });
}

async function drainOne(filename, { serverUrl, apiKey, cacheDir, extraHeaders, logger }) {
  const fullPath = join(queueDir(cacheDir), filename);

  const { payload, error } = loadPayload(fullPath);
  if (error) {
    moveToFailed(cacheDir, filename, error, logger);
    return { status: 'failed' };
  }

  const headers = buildHeaders(apiKey, extraHeaders);
  const lastLine = await fetchLastPosition(serverUrl, headers, payload.sessionId);
  const segment = extractSegment(payload.filteredTranscript, lastLine);

  let res;
  try {
    res = await postSegment(serverUrl, headers, payload, segment);
  } catch (err) {
    logger.warn(`jarvis.drain.network-error: ${filename} ${errMsg(err)}`);
    return { status: 'retry' };
  }

  if (res.ok) {
    try { unlinkSync(fullPath); } catch { /* file may already be gone */ }
    return { status: 'sent' };
  }

  if (isRetryable(res.status)) {
    logger.warn(`jarvis.drain.retryable: ${filename} status=${res.status}`);
    return { status: 'retry' };
  }

  moveToFailed(cacheDir, filename, `http:${res.status}`, logger);
  return { status: 'failed' };
}

export async function drainConversations({ serverUrl, apiKey, cacheDir, extraHeaders = {}, logger = STDERR_FALLBACK_LOGGER }) {
  if (!apiKey) return { sent: 0, failed: 0, retried: 0, skipped: 'no-api-key' };

  const files = listQueueFiles(cacheDir);
  if (files.length === 0) return { sent: 0, failed: 0, retried: 0 };

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const filename of files) {
    const result = await drainOne(filename, { serverUrl, apiKey, cacheDir, extraHeaders, logger });
    if (result.status === 'sent') sent++;
    else if (result.status === 'failed') failed++;
    else retried++;
  }

  return { sent, failed, retried };
}

export { QUEUE_DIRNAME };
