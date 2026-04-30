/**
 * Reads queue files from a cache directory's pending-conversations folder
 * and parses each as JSON. Used by SessionEnd and PreCompact hook tests.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readQueueFiles(cacheDir) {
  const dir = join(cacheDir, 'pending-conversations');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
    .map((name) => ({
      name,
      payload: JSON.parse(readFileSync(join(dir, name), 'utf8')),
    }));
}
