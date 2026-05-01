/**
 * Stdlib-only exclusive file lock used to serialise critical sections that
 * mutate worker-lifecycle state. Two call sites: the SessionStart hook's
 * kill+spawn path in `worker-manager.js`, and the worker's `migrateLegacyWorkspace`
 * call on boot. Both sides import the same `withLock` helper so the locking
 * semantics stay identical.
 *
 * Why stdlib instead of `proper-lockfile`. The plugin's "no new deps" rule
 * (spec-1 review-team) plus the spec's own "Simplicity wins" boundary make
 * the ~25-line `openSync('wx')` + mtime stale-check trade favourable: the
 * dependency cost is higher than the implementation cost.
 *
 * Design notes:
 * - `openSync(path, 'wx')` is atomic create with O_EXCL — only one caller
 *   wins per filesystem. The fd itself is closed immediately; lock semantics
 *   come from file existence + mtime.
 * - Polling uses sequential `await new Promise(r => setTimeout(r, retryMs))`,
 *   never `setInterval`, so there is no open handle that would prevent the
 *   parent hook from exiting after `child.unref()` on the spawned worker.
 * - Stale detection compares `statSync(path).mtimeMs` against `staleMs`. If
 *   the prior holder crashed without releasing, the next caller reclaims the
 *   lock without operator intervention.
 * - Release always runs in `finally` and tolerates the lock file already
 *   being gone (ENOENT swallowed) — covers the case where a stale-reclaim
 *   raced with us.
 * - Not reentrant. Same process re-acquiring the same lock path will deadlock
 *   at the second `openSync('wx')`. Current call sites use distinct lock
 *   paths in distinct processes, so this is safe today.
 */

import { openSync, closeSync, statSync, unlinkSync } from 'node:fs';

export class LockTimeoutError extends Error {
  constructor(lockPath) {
    super(`failed to acquire lock at ${lockPath}`);
    this.name = 'LockTimeoutError';
    this.lockPath = lockPath;
  }
}

export async function withLock(lockPath, opts, fn) {
  const { staleMs = 30_000, retryMs = 100, timeoutMs = 2_000 } = opts ?? {};
  const deadline = Date.now() + timeoutMs;

  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      try {
        const stat = statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          try { unlinkSync(lockPath); } catch { /* race: another caller cleaned */ }
          continue;
        }
      } catch { /* lock vanished mid-stat — fall through and retry */ }

      if (Date.now() >= deadline) throw new LockTimeoutError(lockPath);
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  closeSync(fd);

  try {
    return await fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* lock vanished — ignore */ }
  }
}
