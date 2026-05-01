/**
 * One-shot migration: move worker-owned files from the legacy cacheDir into
 * the new workerDir. Idempotent — on subsequent boots there's nothing to move.
 *
 * Conservative on conflicts: if a target already exists in workerDir AND it's
 * a non-empty directory or a regular file, leave the source in place and warn.
 * Empty target directories are removed first so the migration can complete.
 *
 * .worker.pid is intentionally NOT migrated — it's transient state that the
 * worker rewrites on every spawn. Migrating it caused a deadlock where the
 * hook's spawnWorker() pre-creates a PID in workerDir, blocking migration of
 * the legacy file forever.
 *
 * On EXDEV (cross-filesystem rename), falls back to copy-then-unlink so the
 * migration completes instead of stranding queued conversations.
 *
 * Runs before the logger is up, so warnings go directly to process.stderr.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { samePath } from '../../lib/paths.js';

const LEGACY_DIR_ITEMS = ['logs', 'pending-conversations'];

function warn(message) {
  try { process.stderr.write(`jarvis.migrate-workspace: ${message}\n`); } catch { /* ignore */ }
}

function isEmptyDirectory(path) {
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) return false;
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

function moveAcrossDevices(source, target) {
  cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  rmSync(source, { recursive: true, force: true });
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function moveOne(name, cacheDir, workerDir) {
  const source = join(cacheDir, name);
  if (!existsSync(source)) return;

  // Symlink guard: renameSync would relocate the link node, breaking a user's
  // intentional `~/.jarvis-cache/ai-memory/logs → /var/log/jarvis` setup. Leave
  // the symlink in place and let the worker write under workerDir per the
  // post-migration contract.
  if (isSymlink(source)) {
    warn(`jarvis.migrate.symlink-skipped: ${source}`);
    return;
  }

  const target = join(workerDir, name);
  if (existsSync(target)) {
    if (isEmptyDirectory(target)) {
      try { rmSync(target, { recursive: true, force: true }); } catch { /* fall through to skip */ }
    }
    if (existsSync(target)) {
      warn(`skip ${name}: target already exists at ${target} (source kept at ${source})`);
      return;
    }
  }

  try {
    renameSync(source, target);
    warn(`moved ${name}: ${source} → ${target}`);
    return;
  } catch (err) {
    if (err && err.code !== 'EXDEV') {
      const message = err instanceof Error ? err.message : String(err);
      warn(`failed to move ${name}: ${message} (source left at ${source})`);
      return;
    }
  }

  // EXDEV: copy across filesystems, then unlink source.
  try {
    moveAcrossDevices(source, target);
    warn(`copied ${name} across filesystems: ${source} → ${target}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`failed to copy ${name} across filesystems: ${message} (source left at ${source})`);
    // Best-effort cleanup of half-written target.
    try { rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function removeLegacyPidFile(cacheDir) {
  const legacyPid = join(cacheDir, '.worker.pid');
  if (!existsSync(legacyPid)) return;
  try {
    unlinkSync(legacyPid);
    warn(`removed legacy .worker.pid: ${legacyPid} (worker rewrites this on every spawn)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`failed to remove legacy .worker.pid: ${message}`);
  }
}

export function migrateLegacyWorkspace({ cacheDir, workerDir } = {}) {
  if (!cacheDir || !workerDir) return;
  if (samePath(cacheDir, workerDir)) return;

  try {
    mkdirSync(workerDir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`failed to ensure workerDir exists: ${message}`);
    return;
  }

  for (const name of LEGACY_DIR_ITEMS) {
    moveOne(name, cacheDir, workerDir);
  }

  removeLegacyPidFile(cacheDir);
}
