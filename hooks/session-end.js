/**
 * Stop hook — captures transcript and sends to Jarvis for memory processing.
 * Reads stdin JSON, reads the JSONL transcript file, filters sensitive data,
 * and POSTs the full content to POST /conversations.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { post } from './lib/jarvis-client.js';
import { readTranscript, filterSensitiveData } from './lib/transcript.js';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

const raw = await readStdin();

try {
  const input = JSON.parse(raw);
  const { transcript_path, session_id } = input;

  if (!transcript_path) {
    console.error('jarvis.session-end.skip: no transcript_path in input');
    process.exit(0);
  }

  const content = readTranscript(transcript_path);
  if (content == null) {
    console.error(`jarvis.session-end.skip: could not read ${transcript_path}`);
    process.exit(0);
  }

  const filtered = filterSensitiveData(content);
  await post('/conversations', {
    sessionId: session_id,
    transcript: filtered,
    source: 'stop',
  });

  console.error(`jarvis.session-end.success: sent transcript for session ${session_id}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.session-end.error: ${message}`);
}

process.exit(0);
