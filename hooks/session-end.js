/**
 * SessionEnd hook — captures transcript, redacts secrets, drops a queue file.
 * Worker drains the queue asynchronously. Hook MUST exit fast (<200ms target)
 * so the harness does not cancel it. ALWAYS exits 0.
 */

import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hrtime } from 'node:process';
import { readTranscript, filterSensitiveData } from './lib/transcript.js';
import { config } from './lib/jarvis-client.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const STDIN_TIMEOUT_MS = 2000;

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveHome(p) {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

function readPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}

function enqueue(payload, cacheDir) {
  const dir = join(cacheDir, 'pending-conversations');
  mkdirSync(dir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${hrtime.bigint().toString(36)}`;
  const filename = `${payload.sessionId}-${uniqueSuffix}.json`;
  const finalPath = join(dir, filename);
  const tempPath = `${finalPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, finalPath);
  return finalPath;
}

const raw = await readStdin();

try {
  const input = JSON.parse(raw);
  const { transcript_path, session_id } = input;

  if (!transcript_path || !session_id) {
    console.error('jarvis.session-end.skip: missing transcript_path or session_id');
    process.exit(0);
  }

  if (!SESSION_ID_PATTERN.test(session_id)) {
    console.error(`jarvis.session-end.skip: invalid session_id (must match ${SESSION_ID_PATTERN})`);
    process.exit(0);
  }

  const content = readTranscript(transcript_path);
  if (content == null) {
    console.error(`jarvis.session-end.skip: could not read ${transcript_path}`);
    process.exit(0);
  }

  const filteredTranscript = filterSensitiveData(content);
  const cacheDir = resolveHome(config.cacheDir);

  const payload = {
    sessionId: session_id,
    source: 'stop',
    segmentStartLine: null,
    segmentEndLine: null,
    filteredTranscript,
    enqueuedAt: new Date().toISOString(),
    pluginVersion: readPluginVersion(),
  };

  const path = enqueue(payload, cacheDir);
  console.error(`jarvis.session-end.queued: ${path}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.session-end.error: ${message}`);
}

process.exit(0);
