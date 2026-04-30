/**
 * SessionStart hook — ensures the local Jarvis worker is running and at the right version.
 * Drains any leftover queue files from prior crashes via the worker's startup drain.
 * Fire-and-forget: spawns detached child and exits. ALWAYS exits 0.
 */

import { ensureWorkerRunning } from './lib/worker-manager.js';
import { readStdin } from './lib/read-stdin.js';

await readStdin();

try {
  await ensureWorkerRunning();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.session-start-worker.error: ${message}`);
}

process.exit(0);
