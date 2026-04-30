/**
 * SessionStart hook — ensures the local Jarvis worker is running and at the right version.
 * Drains any leftover queue files from prior crashes via the worker's startup drain.
 * Fire-and-forget: spawns detached child and exits. ALWAYS exits 0.
 */

import { ensureWorkerRunning } from './lib/worker-manager.js';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

await readStdin();

try {
  await ensureWorkerRunning();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.session-start-worker.error: ${message}`);
}

process.exit(0);
