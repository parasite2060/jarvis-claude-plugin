/**
 * SessionStart hook — injects Jarvis memory context into Claude's session.
 * Reads stdin JSON, calls GET /memory/context, outputs hookSpecificOutput.additionalContext.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getContext, config } from './lib/jarvis-client.js';
import { ensureWorkerRunning } from './lib/worker-manager.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

function resolveCacheDir() {
  const dir = config.cacheDir || '~/.jarvis-cache/ai-memory';
  return dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir;
}

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
  const context = await getContext();
  const cacheDir = resolveCacheDir();
  const header = `JARVIS_CACHE_DIR: ${cacheDir}\n\n`;

  // Start background file sync worker (non-blocking, fire-and-forget)
  ensureWorkerRunning().catch(() => {});

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: header + (context ?? ''),
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
