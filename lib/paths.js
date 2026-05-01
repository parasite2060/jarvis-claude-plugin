/**
 * Shared path utilities used by both hook and worker code.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Strings that look set but are effectively unset in practice. Claude Code
// sometimes propagates the literal string "undefined" for unconfigured plugin
// envs; an empty string and "." (CWD) are equally dangerous as path defaults.
const SENTINEL_UNSET = new Set(['', '.', 'undefined', 'null']);

export function isUnsetPath(value) {
  return typeof value !== 'string' || SENTINEL_UNSET.has(value.trim());
}

export function resolveHome(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('~')) return join(homedir(), path.slice(1));
  return path;
}

/**
 * True when two paths refer to the same directory after tilde expansion,
 * absolute resolution, and trailing-slash normalization. Catches the
 * common cases where a string-equality compare would falsely diverge.
 */
export function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return resolve(resolveHome(a)) === resolve(resolveHome(b));
}
