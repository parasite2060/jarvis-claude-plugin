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
 * Only redacts structured secret formats — never over-filters conversation text.
 * @param {string} content - Raw transcript content
 * @returns {string} Filtered content with secrets redacted
 */
export function filterSensitiveData(content) {
  let filtered = content;

  // OpenAI-style API keys: sk-... (20+ chars)
  filtered = filtered.replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]');

  // AWS access keys: AKIA... (20 chars)
  filtered = filtered.replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED_AWS_KEY]');

  // Bearer tokens in JSON strings: "Bearer ..." or "bearer ..."
  filtered = filtered.replace(
    /(["']?[Bb]earer\s+)[A-Za-z0-9_.\-\/+=]{20,}/g,
    '$1[REDACTED_TOKEN]'
  );

  // JSON key-value pairs for sensitive fields
  filtered = filtered.replace(
    /("(?:password|secret|token|api_key|apiKey|api[-_]?secret|access[-_]?token|auth[-_]?token)":\s*")([^"]+)(")/gi,
    '$1[REDACTED]$3'
  );

  // Environment variable assignments with sensitive names
  filtered = filtered.replace(
    /((?:API_KEY|SECRET|TOKEN|PASSWORD|APIKEY|AUTH_TOKEN|ACCESS_TOKEN)\s*=\s*)(\S+)/gi,
    '$1[REDACTED]'
  );

  return filtered;
}
