/**
 * SessionStart hook — injects Jarvis memory context into Claude's session.
 * Reads stdin JSON, calls GET /memory/context, outputs hookSpecificOutput.additionalContext.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getContext } from './lib/jarvis-client.js';

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

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context ?? '',
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
