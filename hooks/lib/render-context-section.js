/**
 * Shared SessionStart hook body for the SOUL/IDENTITY/MEMORY family.
 * Each call site differs only in: which Jarvis endpoint to call, the
 * preface text, and the XML tag wrapping the content.
 *
 * Always emits a valid SessionStart hookSpecificOutput (with empty
 * additionalContext on any failure) so the hook never blocks Claude Code.
 */

import { readStdin } from './read-stdin.js';

const HOOK_EVENT_NAME = 'SessionStart';

function emitContext(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: HOOK_EVENT_NAME, additionalContext },
  }));
}

export async function renderContextSection({ tag, preface, fetchContent, errorPrefix }) {
  const raw = await readStdin();
  try {
    JSON.parse(raw);
    const content = await fetchContent();
    const additionalContext = content ? `${preface}<${tag}>\n${content}\n</${tag}>` : '';
    emitContext(additionalContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${errorPrefix}: ${message}\n`);
    emitContext('');
  }
}
