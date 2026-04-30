/**
 * SessionStart hook — injects MEMORY.md (operator memory index) into Claude's session.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getMemory } from './lib/jarvis-client.js';
import { renderContextSection } from './lib/render-context-section.js';

const PREFACE = (
  "Below is your operator's MEMORY index — strong patterns, decisions, facts, " +
  "and recent extractions. Consult this for \"have we done X before\", \"what " +
  "did I decide\", and before recommending libraries or approaches.\n\n"
);

await renderContextSection({
  tag: 'memory',
  preface: PREFACE,
  fetchContent: getMemory,
  errorPrefix: 'jarvis.session-start-memory.error',
});
