/**
 * PreCompact hook — backup transcript to Jarvis before context compaction.
 * Same pattern as session-end: reads transcript_path, POSTs to /conversations.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { post } from './lib/jarvis-client.js';

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
  if (transcript_path) {
    await post('/conversations', { transcript_path, session_id });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.pre-compact.error: ${message}`);
}

process.exit(0);
