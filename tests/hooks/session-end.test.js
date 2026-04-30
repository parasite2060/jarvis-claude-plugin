import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHook } from '../helpers/run-hook.js';
import { readQueueFiles } from '../helpers/queue-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-end.js');

function makeInput(overrides = {}) {
  return JSON.stringify({
    session_id: 'test-session-123',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    hook_event_name: 'Stop',
    ...overrides,
  });
}

describe('session-end hook > with valid transcript file (queue-file contract)', () => {
  let transcriptFile;
  let cacheDir;

  const MOCK_TRANSCRIPT = '{"type":"human","message":{"role":"user","content":"Fix the bug"}}\n{"type":"assistant","message":{"role":"assistant","content":"I will fix it"}}\n';

  beforeAll(() => {
    const tmpRoot = join(tmpdir(), 'jarvis-test-session-end');
    mkdirSync(tmpRoot, { recursive: true });
    transcriptFile = join(tmpRoot, 'transcript.jsonl');
    writeFileSync(transcriptFile, MOCK_TRANSCRIPT, 'utf8');
  });

  afterAll(() => {
    try { unlinkSync(transcriptFile); } catch {}
  });

  beforeEach(() => {
    cacheDir = join(tmpdir(), `jarvis-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch {}
  });

  it('should write a queue file with the filtered transcript when transcript is valid', async () => {
    // Arrange
    const input = makeInput({ transcript_path: transcriptFile });

    // Act
    const { exitCode } = await runHook(HOOK_PATH, input, {
      CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
    });

    // Assert
    expect(exitCode).toBe(0);
    const files = readQueueFiles(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0].name.startsWith('test-session-123-')).toBe(true);
    expect(files[0].payload.sessionId).toBe('test-session-123');
    expect(files[0].payload.filteredTranscript).toBe(MOCK_TRANSCRIPT);
  });

  it('should redact sensitive data when transcript contains an API key', async () => {
    // Arrange
    const sensitiveTranscript = '{"content":"key is sk-abcdefghijklmnopqrstuvwxyz1234567890abcd"}\n';
    const sensitiveFile = transcriptFile + '.sensitive';
    writeFileSync(sensitiveFile, sensitiveTranscript, 'utf8');
    const input = makeInput({ transcript_path: sensitiveFile });

    // Act
    const { exitCode } = await runHook(HOOK_PATH, input, {
      CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
    });

    // Assert
    expect(exitCode).toBe(0);
    const files = readQueueFiles(cacheDir);
    expect(files[0].payload.filteredTranscript).toContain('[REDACTED_API_KEY]');
    expect(files[0].payload.filteredTranscript).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');

    try { unlinkSync(sensitiveFile); } catch {}
  });

  it('should record source "stop" and pluginVersion when payload is enqueued', async () => {
    // Arrange
    const input = makeInput({ transcript_path: transcriptFile });

    // Act
    await runHook(HOOK_PATH, input, {
      CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
    });

    // Assert
    const files = readQueueFiles(cacheDir);
    expect(files[0].payload).toMatchObject({
      sessionId: 'test-session-123',
      source: 'stop',
      segmentStartLine: null,
      segmentEndLine: null,
    });
    expect(typeof files[0].payload.pluginVersion).toBe('string');
    expect(files[0].payload.enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('session-end hook > error handling', () => {
  it('should exit 0 with skip log when transcript_path is missing', async () => {
    // Arrange
    const input = makeInput({ transcript_path: undefined });

    // Act
    const { exitCode, stderr } = await runHook(HOOK_PATH, input);

    // Assert
    expect(exitCode).toBe(0);
    expect(stderr).toContain('jarvis.session-end.skip');
  });

  it('should exit 0 with skip log when transcript file does not exist', async () => {
    // Arrange
    const input = makeInput({ transcript_path: '/tmp/nonexistent-file-xyz.jsonl' });

    // Act
    const { exitCode, stderr } = await runHook(HOOK_PATH, input);

    // Assert
    expect(exitCode).toBe(0);
    expect(stderr).toContain('jarvis.session-end.skip');
  });

  it('should exit 0 even when there is no network access (queue write only)', async () => {
    // Arrange
    const tmpDir = join(tmpdir(), `jarvis-cache-network-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const tmpFile = join(tmpDir, 'transcript.jsonl');
    writeFileSync(tmpFile, '{"type":"human"}\n', 'utf8');
    const input = makeInput({ transcript_path: tmpFile });

    // Act
    const { exitCode } = await runHook(HOOK_PATH, input, {
      CLAUDE_PLUGIN_OPTION_CACHEDIR: tmpDir,
      CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://localhost:19999',
    });

    // Assert
    expect(exitCode).toBe(0);

    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });
});
