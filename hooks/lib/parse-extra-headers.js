/**
 * Parses an "extraHeaders" config value (a JSON object string) into a headers map.
 * Returns {} on absence or invalid JSON — never throws.
 */

export function parseExtraHeaders(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}
