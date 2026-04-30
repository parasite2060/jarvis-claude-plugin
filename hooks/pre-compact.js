/**
 * PreCompact hook — captures transcript, redacts secrets, drops a queue file
 * before context compaction. Worker drains the queue asynchronously. Hook
 * MUST exit fast (<200ms target) so the harness does not cancel it.
 * ALWAYS exits 0.
 */

import { readStdin } from './lib/read-stdin.js';
import { enqueueTranscript } from './lib/enqueue-transcript.js';

const raw = await readStdin();

try {
  const result = enqueueTranscript({ source: 'pre-compact', input: JSON.parse(raw) });
  if (result.skipped) {
    console.error(`jarvis.pre-compact.skip: ${result.skipped}`);
  } else {
    console.error(`jarvis.pre-compact.queued: ${result.queuedAt}`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.pre-compact.error: ${message}`);
}

process.exit(0);
