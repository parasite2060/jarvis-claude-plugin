/**
 * Shared HTTP client for Jarvis server communication.
 * Reads config from CLI args (passed by hooks.json via ${user_config.*})
 * or falls back to CLAUDE_PLUGIN_OPTION_* env vars.
 * Returns null on any error — graceful degradation is the contract.
 */

import { parseArgs } from './parse-args.js';

const config = parseArgs();

function parseExtraHeaders(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

const EXTRA_HEADERS = parseExtraHeaders(config.extraHeaders);

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    ...EXTRA_HEADERS,
  };
}

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export async function get(path) {
  try {
    const response = await fetch(`${config.serverUrl}${path}`, {
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
    const response = await fetch(`${config.serverUrl}${path}`, {
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

export { config };
