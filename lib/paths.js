/**
 * Shared path utilities used by both hook and worker code.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveHome(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('~')) return join(homedir(), path.slice(1));
  return path;
}
