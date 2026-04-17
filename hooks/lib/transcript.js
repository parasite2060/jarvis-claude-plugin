import { readFileSync } from 'node:fs';

/**
 * Reads a JSONL transcript file and returns its content as a string.
 * @param {string} transcriptPath - Absolute path to the JSONL file
 * @returns {string | null} File content or null on error
 */
export function readTranscript(transcriptPath) {
  try {
    return readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.transcript.read-error: ${message}`);
    return null;
  }
}

/**
 * Filters sensitive data from transcript content using conservative regex patterns.
 * Mirrors the server-side SecretScrubber pattern set (Story 10.1). The server
 * remains authoritative — this client filter reduces bytes on the wire and
 * catches secrets before they leave the user's machine.
 *
 * Ordering: multi-line PEM first, then single-line patterns. JSON/env-value
 * patterns run last and skip values already shaped as `[REDACTED*]` placeholders
 * so we don't re-redact earlier replacements.
 *
 * @param {string} content - Raw transcript content
 * @returns {string} Filtered content with secrets redacted
 */
export function filterSensitiveData(content) {
  let filtered = content;

  // PEM private key blocks (multi-line). [\s\S] emulates Python's re.DOTALL.
  filtered = filtered.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED_PEM]'
  );

  // Anthropic keys must come before the generic sk- rule so sk-ant-... is
  // not matched twice.
  filtered = filtered.replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]');

  // OpenAI-style sk- keys.
  filtered = filtered.replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]');

  // AWS access keys.
  filtered = filtered.replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED_AWS_KEY]');

  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_).
  filtered = filtered.replace(
    /gh[pousr]_[A-Za-z0-9]{36,}/g,
    '[REDACTED_GITHUB_TOKEN]'
  );

  // Google API keys.
  filtered = filtered.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, '[REDACTED_GOOGLE_KEY]');

  // Slack tokens.
  filtered = filtered.replace(
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    '[REDACTED_SLACK_TOKEN]'
  );

  // JWTs (three base64url segments separated by dots). Character class must
  // exclude `.` so the regex stops at the three-segment boundary and matches
  // Python's semantics in `secret_scrubber.py` (AC7 parity).
  filtered = filtered.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[REDACTED_JWT]'
  );

  // URL basic-auth credentials across common schemes.
  filtered = filtered.replace(
    /(https?|postgres|postgresql|mongodb(?:\+srv)?|redis|amqp|mysql):\/\/[^\s:/@]+:[^\s@]+@/g,
    '$1://[REDACTED_USER]:[REDACTED_PW]@'
  );

  // Bearer tokens in JSON strings: "Bearer ..." or "bearer ..."
  filtered = filtered.replace(
    /(["']?[Bb]earer\s+)[A-Za-z0-9_.\-/+=]{20,}/g,
    '$1[REDACTED_TOKEN]'
  );

  // JSON key-value pairs for sensitive fields. Handles both unescaped and
  // JSON-escaped quotes (\" in nested JSON strings). Skips values already
  // shaped as [REDACTED...] placeholders.
  filtered = filtered.replace(
    /(\\?"(?:password|passwd|secret|api_key|apiKey|api[-_]?secret|access[-_]?token|auth[-_]?token|refresh_token|client_secret|private_key|signing_key|encryption_key)\\?"\s*:\s*\\?")(?!\[REDACTED)([^"\\]+)(\\?")/gi,
    '$1[REDACTED]$3'
  );

  // Environment-variable assignments with sensitive names. Skip already-redacted.
  filtered = filtered.replace(
    /((?:API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|AUTH_SECRET|DB_PASSWORD|ENCRYPTION_KEY|SIGNING_KEY|PRIVATE_KEY)\s*=\s*)(?!\[REDACTED)(\S+)/gi,
    '$1[REDACTED]'
  );

  return filtered;
}
