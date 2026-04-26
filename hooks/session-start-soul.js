/**
 * SessionStart hook — injects SOUL.md (operator persona) into Claude's session.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getSoul } from './lib/jarvis-client.js';

const PREFACE = (
  "Below is your operator's SOUL — worldview, decision principles, opinions, " +
  "tensions, and boundaries. Treat this as authoritative for tone, judgment, and " +
  "reasoning style. Match the persona; don't summarize it back at the user.\n\n" +
  "## SOUL\n\n"
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
  const soul = await getSoul();
  const additionalContext = soul ? PREFACE + soul : '';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start-soul.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
