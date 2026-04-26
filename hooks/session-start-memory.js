/**
 * SessionStart hook — injects MEMORY.md (operator memory index) into Claude's session.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getMemory } from './lib/jarvis-client.js';

const PREFACE = (
  "Below is your operator's MEMORY index — strong patterns, decisions, facts, " +
  "and recent extractions. Consult this for \"have we done X before\", \"what " +
  "did I decide\", and before recommending libraries or approaches.\n\n" +
  "## MEMORY\n\n"
);

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
  const memory = await getMemory();
  const additionalContext = memory ? PREFACE + memory : '';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start-memory.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
