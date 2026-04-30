/**
 * Shared HTTP client for Jarvis server communication.
 * Reads config from CLI args (passed by hooks.json via ${user_config.*})
 * or falls back to CLAUDE_PLUGIN_OPTION_* env vars.
 * Returns null on any error — graceful degradation is the contract.
 */

import { parseArgs } from './parse-args.js';
import { parseExtraHeaders } from './parse-extra-headers.js';

const config = parseArgs();
const EXTRA_HEADERS = parseExtraHeaders(config.extraHeaders);

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    ...EXTRA_HEADERS,
  };
}

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

function unwrapDataField(envelope, field) {
  const inner = envelope?.data;
  if (typeof inner !== 'object' || inner === null) return null;
  if (!(field in inner)) return null;
  return inner[field];
}

async function getMemoryDocument(endpoint) {
  const envelope = await get(endpoint);
  if (envelope == null) return null;
  const content = unwrapDataField(envelope, 'content');
  return content == null ? null : String(content);
}

/**
 * Fetch assembled memory context for session injection.
 */
export async function getContext() {
  const envelope = await get('/memory/context');
  if (envelope == null) return null;
  const context = unwrapDataField(envelope, 'context');
  return context == null ? null : String(context);
}

export const getSoul     = () => getMemoryDocument('/memory/soul');
export const getIdentity = () => getMemoryDocument('/memory/identity');
export const getMemory   = () => getMemoryDocument('/memory/memory');

/**
 * Fetch the file manifest from /memory/files/manifest.
 * Returns array of { path, updatedAt } sorted by manifest order.
 */
export async function getFileManifest() {
  const envelope = await get('/memory/files/manifest');
  if (envelope == null) return [];
  const files = unwrapDataField(envelope, 'files');
  if (!Array.isArray(files)) return [];
  return files.map((f) => ({
    path: String(f.path),
    updatedAt: String(f.updatedAt),
  }));
}

export { config };
