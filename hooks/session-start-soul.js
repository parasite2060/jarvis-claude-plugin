/**
 * SessionStart hook — injects SOUL.md (operator persona) into Claude's session.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getSoul } from './lib/jarvis-client.js';
import { renderContextSection } from './lib/render-context-section.js';

const PREFACE = (
  "Below is your operator's SOUL — worldview, decision principles, opinions, " +
  "tensions, and boundaries. Treat this as authoritative for tone, judgment, and " +
  "reasoning style. Match the persona; don't summarize it back at the user.\n\n"
);

await renderContextSection({
  tag: 'soul',
  preface: PREFACE,
  fetchContent: getSoul,
  errorPrefix: 'jarvis.session-start-soul.error',
});
