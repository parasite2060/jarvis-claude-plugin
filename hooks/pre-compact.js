/**
 * PreCompact hook — backup transcript to Jarvis before context compaction.
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
    console.error('jarvis.pre-compact.skip: no transcript_path in input');
    process.exit(0);
  }

  const content = readTranscript(transcript_path);
  if (content == null) {
    console.error(`jarvis.pre-compact.skip: could not read ${transcript_path}`);
    process.exit(0);
  }

  const filtered = filterSensitiveData(content);
  await post('/conversations', {
    sessionId: session_id,
    transcript: filtered,
    source: 'pre-compact',
  });

  console.error(`jarvis.pre-compact.success: sent transcript for session ${session_id}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.pre-compact.error: ${message}`);
}

process.exit(0);
