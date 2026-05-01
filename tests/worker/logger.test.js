import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../../worker/lib/logger.js';

describe('worker logger', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-logger-'));
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('should create the log directory and write the active worker.log when first message is logged', () => {
    // Arrange
    const logsDir = join(dir, 'nested', 'logs');
    const logger = createLogger({ dir: logsDir });

    // Act
    logger.info('hello world');

    // Assert
    expect(existsSync(logsDir)).toBe(true);
    const contents = readFileSync(join(logsDir, 'worker.log'), 'utf8');
    expect(contents).toContain('INFO');
    expect(contents).toContain('hello world');
    expect(contents).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should append newline-terminated lines when multiple messages are logged', () => {
    // Arrange
    const logger = createLogger({ dir });

    // Act
    logger.info('first');
    logger.warn('second');
    logger.error('third');

    // Assert
    const contents = readFileSync(join(dir, 'worker.log'), 'utf8');
    const lines = contents.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('INFO');
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('WARN');
    expect(lines[2]).toContain('ERROR');
  });

  it('should rotate worker.log when the UTC date changes between writes', () => {
    // Arrange
    let now = new Date('2026-04-30T12:00:00Z').getTime();
    const logger = createLogger({ dir, nowFn: () => now });
    logger.info('day-one line');

    // Act
    now = new Date('2026-05-01T00:30:00Z').getTime();
    logger.info('day-two line');

    // Assert
    const rotated = join(dir, 'worker-2026-04-30.log');
    expect(existsSync(rotated)).toBe(true);
    expect(readFileSync(rotated, 'utf8')).toContain('day-one line');
    const active = readFileSync(join(dir, 'worker.log'), 'utf8');
    expect(active).toContain('day-two line');
    expect(active).not.toContain('day-one line');
  });

  it('should prune rotated log files when they are older than retentionDays', () => {
    // Arrange
    const old = join(dir, 'worker-2026-04-22.log');
    const fresh = join(dir, 'worker-2026-04-29.log');
    writeFileSync(old, 'old');
    writeFileSync(fresh, 'fresh');
    const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    const oneDayAgo = (Date.now() - 1 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(old, eightDaysAgo, eightDaysAgo);
    utimesSync(fresh, oneDayAgo, oneDayAgo);

    // Act
    createLogger({ dir, retentionDays: 7 });

    // Assert
    const remaining = readdirSync(dir);
    expect(remaining).not.toContain('worker-2026-04-22.log');
    expect(remaining).toContain('worker-2026-04-29.log');
  });

  it('should rotate a stale worker.log when prior process wrote on a previous day', () => {
    // Arrange
    const prior = join(dir, 'worker.log');
    writeFileSync(prior, 'yesterday content\n');
    const yesterdayEpoch = (Date.UTC(2026, 3, 29, 12, 0, 0)) / 1000;
    utimesSync(prior, yesterdayEpoch, yesterdayEpoch);
    const todayMs = Date.UTC(2026, 3, 30, 0, 1, 0);
    const logger = createLogger({ dir, nowFn: () => todayMs });

    // Act
    logger.info('today line');

    // Assert
    expect(existsSync(join(dir, 'worker-2026-04-29.log'))).toBe(true);
    expect(readFileSync(join(dir, 'worker-2026-04-29.log'), 'utf8')).toContain('yesterday content');
    const active = readFileSync(prior, 'utf8');
    expect(active).toContain('today line');
    expect(active).not.toContain('yesterday content');
  });

  it('should throw when retentionDays is zero, negative, or non-integer', () => {
    // Act & Assert
    expect(() => createLogger({ dir, retentionDays: 0 })).toThrow();
    expect(() => createLogger({ dir, retentionDays: -1 })).toThrow();
    expect(() => createLogger({ dir, retentionDays: 1.5 })).toThrow();
  });

  it('should not advance activeDate when rotation rename fails (retries on next write)', () => {
    // Arrange
    let now = new Date('2026-04-30T12:00:00Z').getTime();
    const logger = createLogger({ dir, nowFn: () => now });
    logger.info('day-one');
    const blocker = join(dir, 'worker-2026-04-30.log');
    mkdirSync(blocker);
    writeFileSync(join(blocker, 'placeholder'), 'x');
    now = new Date('2026-05-01T00:30:00Z').getTime();
    logger.info('day-two-attempt');

    // Act
    rmSync(blocker, { recursive: true, force: true });
    now = new Date('2026-05-01T00:31:00Z').getTime();
    logger.info('day-two-retry');

    // Assert
    expect(existsSync(blocker)).toBe(true);
    expect(readFileSync(blocker, 'utf8')).toContain('day-one');
  });

  it('should re-create the log directory and write the next line when logs dir is removed after rotation', () => {
    // Arrange
    let now = new Date('2026-04-30T12:00:00Z').getTime();
    const logger = createLogger({ dir, nowFn: () => now });
    logger.info('day-one line');

    // Act — advance to next day to trigger rotation, which resets dirReady.
    now = new Date('2026-05-01T00:30:00Z').getTime();
    logger.info('day-two line');
    rmSync(dir, { recursive: true, force: true });
    logger.info('after-recovery line');

    // Assert
    expect(existsSync(dir)).toBe(true);
    const active = readFileSync(join(dir, 'worker.log'), 'utf8');
    expect(active).toContain('after-recovery line');
  });

  it('should fall back to stderr when the log directory cannot be created', () => {
    // Arrange
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ dir: join(dir, 'bad\0name') });

    // Act
    logger.error('still alive');

    // Assert
    expect(stderrSpy).toHaveBeenCalled();
    const wrote = stderrSpy.mock.calls.some(([line]) =>
      typeof line === 'string' && line.includes('still alive'),
    );
    expect(wrote).toBe(true);
    stderrSpy.mockRestore();
  });
});
