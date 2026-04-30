/**
 * SessionStart hook — injects IDENTITY.md (operator identity) into Claude's session.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getIdentity } from './lib/jarvis-client.js';
import { renderContextSection } from './lib/render-context-section.js';

const PREFACE = (
  "Below is your operator's IDENTITY — role, tech stack, working style, active " +
  "projects. Use this to tailor recommendations, default tools, and " +
  "communication level.\n\n"
);

await renderContextSection({
  tag: 'identity',
  preface: PREFACE,
  fetchContent: getIdentity,
  errorPrefix: 'jarvis.session-start-identity.error',
});
