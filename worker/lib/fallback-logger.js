/**
 * Default logger for callers that import worker modules without injecting one
 * (tests, manual invocation). info is suppressed; warn/error fall through to
 * stderr so failures stay visible.
 */

function writeStderr(message) {
  try { console.error(message); } catch { /* ignore */ }
}

export const STDERR_FALLBACK_LOGGER = {
  info: () => {},
  warn: writeStderr,
  error: writeStderr,
};
