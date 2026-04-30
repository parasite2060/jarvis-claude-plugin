import { readdirSync, readFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const QUEUE_DIRNAME = 'pending-conversations';
const FAILED_DIRNAME = '.failed';
const OVERLAP_LINES = 20;
const FETCH_TIMEOUT_MS = 10_000;

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

function moveToFailed(cacheDir, filename, reason) {
  try {
    mkdirSync(failedDir(cacheDir), { recursive: true });
    renameSync(join(queueDir(cacheDir), filename), join(failedDir(cacheDir), filename));
    console.error(`jarvis.drain.failed-moved: ${filename} reason=${reason}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.drain.failed-move-error: ${filename} ${msg}`);
  }
}

async function drainOne(filename, { serverUrl, apiKey, cacheDir, extraHeaders }) {
  const fullPath = join(queueDir(cacheDir), filename);

  let payload;
  try {
    payload = JSON.parse(readFileSync(fullPath, 'utf8'));
  } catch (err) {
    moveToFailed(cacheDir, filename, `parse:${err instanceof Error ? err.message : String(err)}`);
    return { status: 'failed' };
  }

  const { sessionId, source, filteredTranscript } = payload;
  if (!sessionId || typeof filteredTranscript !== 'string') {
    moveToFailed(cacheDir, filename, 'malformed:missing-fields');
    return { status: 'failed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...extraHeaders,
  };

  const lastLine = await fetchLastPosition(serverUrl, headers, sessionId);
  const { content, startLine, endLine } = extractSegment(filteredTranscript, lastLine);

  let res;
  try {
    res = await fetchWithTimeout(`${serverUrl}/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId,
        transcript: content,
        source: source || 'stop',
        segmentStartLine: startLine,
        segmentEndLine: endLine,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.drain.network-error: ${filename} ${msg}`);
    return { status: 'retry' };
  }

  if (res.ok) {
    try { unlinkSync(fullPath); } catch { /* file may already be gone */ }
    return { status: 'sent' };
  }

  if (isRetryable(res.status)) {
    console.error(`jarvis.drain.retryable: ${filename} status=${res.status}`);
    return { status: 'retry' };
  }

  moveToFailed(cacheDir, filename, `http:${res.status}`);
  return { status: 'failed' };
}

export async function drainConversations({ serverUrl, apiKey, cacheDir, extraHeaders = {} }) {
  if (!apiKey) return { sent: 0, failed: 0, retried: 0, skipped: 'no-api-key' };

  const files = listQueueFiles(cacheDir);
  if (files.length === 0) return { sent: 0, failed: 0, retried: 0 };

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const filename of files) {
    const result = await drainOne(filename, { serverUrl, apiKey, cacheDir, extraHeaders });
    if (result.status === 'sent') sent++;
    else if (result.status === 'failed') failed++;
    else retried++;
  }

  return { sent, failed, retried };
}

export { QUEUE_DIRNAME };
