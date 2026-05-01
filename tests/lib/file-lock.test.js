import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withLock, LockTimeoutError } from '../../lib/file-lock.js';

describe('withLock', () => {
  let dir;
  let lockPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-lock-'));
    lockPath = join(dir, '.test.lock');
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should resolve to fn return value and release the lock when fn completes', async () => {
    // Arrange
    const fn = async () => 'value';

    // Act
    const result = await withLock(lockPath, {}, fn);

    // Assert
    expect(result).toBe('value');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('should serialise concurrent acquires when first holder releases', async () => {
    // Arrange
    const order = [];
    const first = withLock(lockPath, { retryMs: 20, timeoutMs: 1_000 }, async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 200));
      order.push('first-end');
      return 'first';
    });
    // Give the first acquire a tick to land on disk before the second tries.
    await new Promise((r) => setTimeout(r, 10));
    const startedAt = Date.now();
    const second = withLock(lockPath, { retryMs: 20, timeoutMs: 1_000 }, async () => {
      order.push('second-start');
      return 'second';
    });

    // Act
    const results = await Promise.all([first, second]);
    const elapsed = Date.now() - startedAt;

    // Assert
    expect(results).toEqual(['first', 'second']);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(500);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('should reclaim a stale lock when its mtime is older than staleMs', async () => {
    // Arrange — manually plant a stale lock file (mtime 10s ago, staleMs=1s).
    writeFileSync(lockPath, '');
    const tenSecondsAgo = (Date.now() - 10_000) / 1000;
    utimesSync(lockPath, tenSecondsAgo, tenSecondsAgo);

    // Act
    const result = await withLock(
      lockPath,
      { staleMs: 1_000, retryMs: 20, timeoutMs: 500 },
      async () => 'reclaimed',
    );

    // Assert
    expect(result).toBe('reclaimed');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('should throw LockTimeoutError when the lock is held past timeoutMs', async () => {
    // Arrange — first holder pins the lock for the duration of the test.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holding = withLock(lockPath, { retryMs: 20, timeoutMs: 5_000 }, async () => {
      await held;
    });
    await new Promise((r) => setTimeout(r, 20));

    // Act & Assert
    await expect(
      withLock(lockPath, { retryMs: 20, timeoutMs: 200 }, async () => 'never'),
    ).rejects.toBeInstanceOf(LockTimeoutError);

    // Cleanup — release the holder so the test process exits cleanly.
    release();
    await holding;
  });

  it('should release the lock when the wrapped fn throws', async () => {
    // Arrange
    const boom = new Error('boom');

    // Act
    await expect(
      withLock(lockPath, {}, async () => { throw boom; }),
    ).rejects.toBe(boom);

    // Assert
    expect(existsSync(lockPath)).toBe(false);
  });
});
