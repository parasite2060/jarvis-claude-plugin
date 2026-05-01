/**
 * Shared queue-write logic for SessionEnd and PreCompact hooks.
 * Both hooks read the same transcript JSONL, redact secrets, and drop a
 * queue file for the worker to drain — only the `source` differs.
 *
 * The queue write is atomic (temp + rename) and uses 0o600 file mode so
 * transcripts on disk are not world-readable. The hook exits in <200ms so
 * Claude Code's hook-cancel window cannot lose work.
 */

import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hrtime } from 'node:process';
import { readTranscript, filterSensitiveData } from './transcript.js';
import { config } from './jarvis-client.js';
import { resolveHome } from '../../lib/paths.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const QUEUE_DIRNAME = 'pending-conversations';
const FILE_MODE = 0o600;

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildPayload({ sessionId, source, filteredTranscript }) {
  return {
    sessionId,
    source,
    segmentStartLine: null,
    segmentEndLine: null,
    filteredTranscript,
    enqueuedAt: new Date().toISOString(),
    pluginVersion: readPluginVersion(),
  };
}

function writeQueueFile(payload, workerDir) {
  const dir = join(workerDir, QUEUE_DIRNAME);
  mkdirSync(dir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${hrtime.bigint().toString(36)}`;
  const finalPath = join(dir, `${payload.sessionId}-${uniqueSuffix}.json`);
  const tempPath = `${finalPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: FILE_MODE });
  renameSync(tempPath, finalPath);
  return finalPath;
}

function validateInput({ transcript_path, session_id }) {
  if (!transcript_path || !session_id) {
    return 'missing transcript_path or session_id';
  }
  if (!SESSION_ID_PATTERN.test(session_id)) {
    return `invalid session_id (must match ${SESSION_ID_PATTERN})`;
  }
  return null;
}

/**
 * Validate input, read the transcript, redact secrets, write a queue file.
 * Returns either { skipped: reason } or { queuedAt: path }.
 */
export function enqueueTranscript({ source, input }) {
  const validationError = validateInput(input);
  if (validationError) return { skipped: validationError };

  const content = readTranscript(input.transcript_path);
  if (content == null) return { skipped: `could not read ${input.transcript_path}` };

  const payload = buildPayload({
    sessionId: input.session_id,
    source,
    filteredTranscript: filterSensitiveData(content),
  });
  // parse-args.js guarantees config.workerDir is a usable string (defaults +
  // sentinel-undefined guard). Just resolve ~ and write.
  const path = writeQueueFile(payload, resolveHome(config.workerDir));
  return { queuedAt: path };
}
