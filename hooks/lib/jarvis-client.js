/**
 * Shared HTTP client for Jarvis server communication.
 * Reads server URL and API key from Claude Code plugin env vars.
 * Returns null on any error — graceful degradation is the contract.
 */

const JARVIS_SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_serverUrl ?? 'http://localhost:8000';
const JARVIS_API_KEY = process.env.CLAUDE_PLUGIN_OPTION_apiKey ?? '';

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JARVIS_API_KEY}`,
  };
}

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export async function get(path) {
  try {
    const response = await fetch(`${JARVIS_SERVER_URL}${path}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
export async function post(path, body) {
  try {
    const response = await fetch(`${JARVIS_SERVER_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch assembled memory context for session injection.
 * @returns {Promise<string | null>}
 */
export async function getContext() {
  const data = await get('/memory/context');
  if (data == null) return null;
  if (typeof data === 'object' && data !== null && 'data' in data) {
    const inner = data.data;
    if (typeof inner === 'object' && inner !== null && 'context' in inner) {
      return String(inner.context);
    }
  }
  return null;
}
