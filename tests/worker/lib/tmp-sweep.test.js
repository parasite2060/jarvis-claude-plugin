import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sweepOrphanTmpFiles } from '../../../worker/lib/tmp-sweep.js';

const TEN_MIN_AGO_SEC = (Date.now() - 10 * 60 * 1000) / 1000;

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('sweepOrphanTmpFiles', () => {
  let workerDir;

  beforeEach(() => {
    workerDir = mkdtempSync(join(tmpdir(), 'jarvis-tmp-sweep-'));
  });

  afterEach(() => {
    try { rmSync(workerDir, { recursive: true, force: true }); } catch {}
  });

  it('should remove a stale .json.tmp file and emit a count log when mtime exceeds the threshold', () => {
    // Arrange
    const queueDir = join(workerDir, 'pending-conversations');
    mkdirSync(queueDir);
    const stale = join(queueDir, 'session-stale.json.tmp');
    writeFileSync(stale, '{}');
    utimesSync(stale, TEN_MIN_AGO_SEC, TEN_MIN_AGO_SEC);
    const logger = makeLogger();

    // Act
    const result = sweepOrphanTmpFiles({ workerDir, logger });

    // Assert
    expect(existsSync(stale)).toBe(false);
    expect(result).toEqual({ swept: 1, errors: 0 });
    expect(logger.info).toHaveBeenCalledWith('jarvis.worker.tmp-swept: count=1');
  });

  it('should preserve a fresh .json.tmp file when mtime is within the threshold', () => {
    // Arrange
    const queueDir = join(workerDir, 'pending-conversations');
    mkdirSync(queueDir);
    const fresh = join(queueDir, 'session-fresh.json.tmp');
    writeFileSync(fresh, '{}');
    const logger = makeLogger();

    // Act
    const result = sweepOrphanTmpFiles({ workerDir, logger });

    // Assert
    expect(existsSync(fresh)).toBe(true);
    expect(result).toEqual({ swept: 0, errors: 0 });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should not emit any log line when no .tmp files match', () => {
    // Arrange
    const queueDir = join(workerDir, 'pending-conversations');
    mkdirSync(queueDir);
    writeFileSync(join(queueDir, 'session-final.json'), '{}');
    const logger = makeLogger();

    // Act
    const result = sweepOrphanTmpFiles({ workerDir, logger });

    // Assert
    expect(result).toEqual({ swept: 0, errors: 0 });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should silently no-op when pending-conversations directory does not exist', () => {
    // Arrange
    const logger = makeLogger();

    // Act
    const result = sweepOrphanTmpFiles({ workerDir, logger });

    // Assert
    expect(result).toEqual({ swept: 0, errors: 0 });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should ignore non-.tmp files even when they are older than the threshold', () => {
    // Arrange
    const queueDir = join(workerDir, 'pending-conversations');
    mkdirSync(queueDir);
    const finalFile = join(queueDir, 'session-final.json');
    writeFileSync(finalFile, '{}');
    utimesSync(finalFile, TEN_MIN_AGO_SEC, TEN_MIN_AGO_SEC);
    const logger = makeLogger();

    // Act
    const result = sweepOrphanTmpFiles({ workerDir, logger });

    // Assert
    expect(existsSync(finalFile)).toBe(true);
    expect(result).toEqual({ swept: 0, errors: 0 });
  });
});
