import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PATTERNS_JSON_PATH = join(__dirname, 'secret_patterns.json');

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

// 'match' MUST remain as the first parameter — String.prototype.replace callback signature is
// (match, p1, p2, ..., offset, string). Removing it would shift `scheme` to position 0 and
// silently break redaction.
function redactUrlBasicAuth(_match, scheme) {
  return `${scheme}://[REDACTED_USER]:[REDACTED_PW]@`;
}

const FUNCTION_REGISTRY = {
  url_basic_auth: redactUrlBasicAuth,
};

function loadPatterns() {
  const raw = readFileSync(PATTERNS_JSON_PATH, 'utf8');
  const data = JSON.parse(raw);

  return data.patterns.map((entry) => {
    const compiled = new RegExp(entry.regex, entry.flags);

    if (entry.replacement_type === 'literal' || entry.replacement_type === 'backref') {
      return { name: entry.name, regex: compiled, replacement: entry.replacement };
    }

    if (entry.replacement_type === 'function') {
      const fn = FUNCTION_REGISTRY[entry.function];
      if (!fn) {
        throw new Error(
          `Unknown function '${entry.function}' for pattern '${entry.name}' — add it to FUNCTION_REGISTRY`
        );
      }
      return { name: entry.name, regex: compiled, replacement: fn };
    }

    throw new Error(
      `Unknown replacement_type '${entry.replacement_type}' for pattern '${entry.name}'`
    );
  });
}

export const SECRET_PATTERNS = loadPatterns();

/**
 * Filters sensitive data from transcript content. Patterns load from
 * `secret_patterns.json` (vendored byte-equal copy of server's canonical file).
 * Story 11.7 enforces parity via unit tests on both sides.
 *
 * @param {string} content - Raw transcript content
 * @returns {string} Filtered content with secrets redacted
 */
export function filterSensitiveData(content) {
  let filtered = content;

  for (const { regex, replacement } of SECRET_PATTERNS) {
    filtered = filtered.replace(regex, replacement);
  }

  return filtered;
}
