import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateLegacyWorkspace } from '../../../worker/lib/migrate-workspace.js';

describe('migrateLegacyWorkspace', () => {
  let cacheDir;
  let workerDir;
  let stderrSpy;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-migrate-'));
    cacheDir = join(root, 'cache');
    workerDir = join(root, 'worker');
    mkdirSync(cacheDir, { recursive: true });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    try { rmSync(join(cacheDir, '..'), { recursive: true, force: true }); } catch {}
  });

  it('should move logs and pending-conversations when they exist in cacheDir', () => {
    // Arrange
    mkdirSync(join(cacheDir, 'logs'));
    writeFileSync(join(cacheDir, 'logs', 'worker.log'), 'log content');
    mkdirSync(join(cacheDir, 'pending-conversations'));
    writeFileSync(join(cacheDir, 'pending-conversations', 'a.json'), '{}');

    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Assert
    expect(existsSync(join(workerDir, 'logs', 'worker.log'))).toBe(true);
    expect(existsSync(join(workerDir, 'pending-conversations', 'a.json'))).toBe(true);
    expect(existsSync(join(cacheDir, 'logs'))).toBe(false);
    expect(existsSync(join(cacheDir, 'pending-conversations'))).toBe(false);
  });

  it('should remove legacy .worker.pid instead of migrating it', () => {
    // Arrange — pid is transient state; worker rewrites on every spawn.
    writeFileSync(join(cacheDir, '.worker.pid'), '12345');

    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Assert
    expect(existsSync(join(cacheDir, '.worker.pid'))).toBe(false);
    expect(existsSync(join(workerDir, '.worker.pid'))).toBe(false);
  });

  it('should be a no-op when cacheDir has nothing to migrate', () => {
    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Assert
    expect(existsSync(join(workerDir, '.worker.pid'))).toBe(false);
    expect(existsSync(join(workerDir, 'logs'))).toBe(false);
  });

  it('should be a no-op when cacheDir resolves to the same path as workerDir', () => {
    // Arrange
    mkdirSync(join(cacheDir, 'logs'));
    writeFileSync(join(cacheDir, 'logs', 'worker.log'), 'x');

    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir: `${cacheDir}/` });

    // Assert
    expect(existsSync(join(cacheDir, 'logs', 'worker.log'))).toBe(true);
  });

  it('should skip with warning when target directory already exists and is non-empty', () => {
    // Arrange
    mkdirSync(workerDir, { recursive: true });
    mkdirSync(join(cacheDir, 'logs'));
    writeFileSync(join(cacheDir, 'logs', 'src.log'), 'source');
    mkdirSync(join(workerDir, 'logs'));
    writeFileSync(join(workerDir, 'logs', 'tgt.log'), 'target');

    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Assert
    expect(existsSync(join(cacheDir, 'logs', 'src.log'))).toBe(true);
    expect(existsSync(join(workerDir, 'logs', 'tgt.log'))).toBe(true);
    const wroteSkip = stderrSpy.mock.calls.some(([line]) =>
      typeof line === 'string' && line.includes('skip logs'),
    );
    expect(wroteSkip).toBe(true);
  });

  it('should reclaim an empty target directory and complete the move', () => {
    // Arrange — an empty target dir from a prior failed migration should not
    // permanently block the next attempt.
    mkdirSync(workerDir, { recursive: true });
    mkdirSync(join(cacheDir, 'pending-conversations'));
    writeFileSync(join(cacheDir, 'pending-conversations', 'a.json'), '{}');
    mkdirSync(join(workerDir, 'pending-conversations'));

    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Assert
    expect(existsSync(join(workerDir, 'pending-conversations', 'a.json'))).toBe(true);
    expect(existsSync(join(cacheDir, 'pending-conversations'))).toBe(false);
  });

  it('should be idempotent on a second invocation', () => {
    // Arrange
    mkdirSync(join(cacheDir, 'logs'));
    writeFileSync(join(cacheDir, 'logs', 'a.log'), 'x');
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Act
    migrateLegacyWorkspace({ cacheDir, workerDir });

    // Assert
    expect(existsSync(join(workerDir, 'logs', 'a.log'))).toBe(true);
    expect(existsSync(join(cacheDir, 'logs'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'should skip symlinked legacy directory and leave the symlink in place when migrating',
    () => {
      // Arrange — user symlinked their legacy logs dir to an external target.
      const externalTarget = join(cacheDir, '..', 'external-logs');
      mkdirSync(externalTarget);
      writeFileSync(join(externalTarget, 'kept.log'), 'external');
      const legacySymlink = join(cacheDir, 'logs');
      symlinkSync(externalTarget, legacySymlink, 'dir');

      // Act
      migrateLegacyWorkspace({ cacheDir, workerDir });

      // Assert
      expect(existsSync(legacySymlink)).toBe(true);
      expect(lstatSync(legacySymlink).isSymbolicLink()).toBe(true);
      expect(existsSync(join(workerDir, 'logs'))).toBe(false);
      const wroteSkip = stderrSpy.mock.calls.some(([line]) =>
        typeof line === 'string' && line.includes('jarvis.migrate.symlink-skipped'),
      );
      expect(wroteSkip).toBe(true);
    },
  );

  it('should continue without throwing when cacheDir or workerDir is missing', () => {
    // Act & Assert
    expect(() => migrateLegacyWorkspace({ cacheDir: '', workerDir })).not.toThrow();
    expect(() => migrateLegacyWorkspace({ cacheDir, workerDir: '' })).not.toThrow();
    expect(() => migrateLegacyWorkspace({})).not.toThrow();
  });
});
