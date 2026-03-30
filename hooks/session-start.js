/**
 * SessionStart hook — injects Jarvis memory context into Claude's session.
 * Reads stdin JSON, calls GET /memory/context, outputs hookSpecificOutput.additionalContext.
 * Also ensures the local worker process is running (best-effort).
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getContext } from './lib/jarvis-client.js';
import { ensureWorkerRunning } from './lib/worker-manager.js';

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
  JSON.parse(raw);
  const [contextResult] = await Promise.allSettled([
    getContext(),
    ensureWorkerRunning(),
  ]);
  const context = contextResult.status === 'fulfilled' ? contextResult.value : null;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: context ?? '',
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`jarvis.session-start.error: ${message}`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { additionalContext: '' },
  }));
}

process.exit(0);
