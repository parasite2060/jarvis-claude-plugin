/**
 * SessionStart hook — injects IDENTITY.md (operator identity) into Claude's session.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getIdentity } from './lib/jarvis-client.js';

const PREFACE = (
  "Below is your operator's IDENTITY — role, tech stack, working style, active " +
  "projects. Use this to tailor recommendations, default tools, and " +
  "communication level.\n\n" +
  "## IDENTITY\n\n"
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
  const identity = await getIdentity();
  const additionalContext = identity ? PREFACE + identity : '';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start-identity.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
