/**
 * Stdlib-only worker logger.
 * - Appends `[ISO] LEVEL message\n` lines to <dir>/worker.log.
 * - Rotates daily (UTC): worker.log → worker-YYYY-MM-DD.log on first write of a new day.
 *   Also rotates an existing worker.log left over from a prior day, so a worker that
 *   restarts at 00:01 UTC does not silently append today's lines to yesterday's file.
 * - Prunes worker-*.log files older than retentionDays on startup and after each rotation.
 * - Falls back to process.stderr on any fs failure so a broken log dir never silences the worker.
 */

import { mkdirSync, appendFileSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROTATED_PATTERN = /^worker-\d{4}-\d{2}-\d{2}\.log$/;
const ACTIVE_FILENAME = 'worker.log';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function utcDateStringFromMs(ms) {
  // Guard against NaN/Infinity from a misbehaving clock injection. Falling back
  // to wall-clock means we still produce a valid date string instead of throwing.
  if (!Number.isFinite(ms)) ms = Date.now();
  return new Date(ms).toISOString().slice(0, 10);
}

function safeStderr(line) {
  try {
    process.stderr.write(line.endsWith('\n') ? line : `${line}\n`);
  } catch {
    // Nothing more we can do.
  }
}

export function createLogger({ dir, retentionDays = 7, nowFn = Date.now } = {}) {
  if (!dir) throw new Error('createLogger: dir is required');
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error(`createLogger: retentionDays must be a positive integer (got ${retentionDays})`);
  }

  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  let activeDate = null;
  let dirReady = false;

  function ensureDir() {
    if (dirReady) return true;
    try {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      dirReady = true;
      return true;
    } catch (err) {
      safeStderr(`jarvis.logger.mkdir-failed: ${err.message}`);
      return false;
    }
  }

  function prune() {
    try {
      const cutoff = nowFn() - retentionMs;
      for (const name of readdirSync(dir)) {
        if (!ROTATED_PATTERN.test(name)) continue;
        const filePath = join(dir, name);
        try {
          if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
        } catch (err) {
          safeStderr(`jarvis.logger.prune-failed: ${name} ${err.message}`);
        }
      }
    } catch (err) {
      safeStderr(`jarvis.logger.prune-readdir-failed: ${err.message}`);
    }
  }

  function existingActiveDate() {
    // Read the active file's mtime so a process that starts on day N+1 rotates
    // a leftover worker.log from day N before its first append.
    try {
      const stat = statSync(join(dir, ACTIVE_FILENAME));
      return utcDateStringFromMs(stat.mtimeMs);
    } catch {
      return null;
    }
  }

  function rotateIfNeeded() {
    const today = utcDateStringFromMs(nowFn());
    if (activeDate === null) {
      // First write of this process — seed activeDate from the existing file's
      // mtime so cross-restart rotation works. Then rotate immediately if stale.
      const seed = existingActiveDate();
      activeDate = seed ?? today;
      if (activeDate === today) return;
    }
    if (activeDate === today) return;

    const rotatedName = `worker-${activeDate}.log`;
    try {
      renameSync(join(dir, ACTIVE_FILENAME), join(dir, rotatedName));
    } catch (err) {
      // Keep activeDate unchanged so the next write retries the rotation rather
      // than silently mixing days into worker.log.
      safeStderr(`jarvis.logger.rotate-failed: ${err.message} (rotation will be retried)`);
      return;
    }
    activeDate = today;
    // Reset so the next write re-runs mkdirSync. If the operator removed the
    // logs dir manually between rotations, we self-heal instead of falling to
    // stderr forever.
    dirReady = false;
    prune();
  }

  function write(level, message) {
    const line = `${new Date(nowFn()).toISOString()} ${level.padEnd(5)} ${message}\n`;
    if (!ensureDir()) {
      safeStderr(line);
      return;
    }
    rotateIfNeeded();
    try {
      appendFileSync(join(dir, ACTIVE_FILENAME), line, { encoding: 'utf8', mode: FILE_MODE });
    } catch (err) {
      safeStderr(`jarvis.logger.write-failed: ${err.message}`);
      safeStderr(line);
    }
  }

  // Run an initial prune so a long-idle machine cleans up the moment the worker boots.
  if (ensureDir()) prune();

  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
  };
}
