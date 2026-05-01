/**
 * Sweep orphan `*.json.tmp` files left behind in pending-conversations/ when a
 * hook process is killed between `writeFileSync(.tmp)` and `renameSync` (see
 * `hooks/lib/enqueue-transcript.js`). Runs once at worker startup before the
 * HTTP listener opens; failures never block startup.
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const TMP_ORPHAN_MAX_AGE_MS = 5 * 60 * 1000;
const TMP_SUFFIX = '.json.tmp';

export function sweepOrphanTmpFiles({ workerDir, logger, maxAgeMs = TMP_ORPHAN_MAX_AGE_MS } = {}) {
  const result = { swept: 0, errors: 0 };
  if (!workerDir) return result;

  const queueDir = join(workerDir, 'pending-conversations');
  let entries;
  try {
    entries = readdirSync(queueDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return result;
    if (logger) logger.warn(`jarvis.worker.tmp-sweep-readdir-failed: ${err.message}`);
    result.errors += 1;
    return result;
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!name.endsWith(TMP_SUFFIX)) continue;
    const filePath = join(queueDir, name);
    try {
      if (statSync(filePath).mtimeMs > cutoff) continue;
      unlinkSync(filePath);
      result.swept += 1;
    } catch (err) {
      if (logger) logger.warn(`jarvis.worker.tmp-sweep-error: ${name} ${err.message}`);
      result.errors += 1;
    }
  }

  if (result.swept > 0 && logger) {
    logger.info(`jarvis.worker.tmp-swept: count=${result.swept}`);
  }

  return result;
}
