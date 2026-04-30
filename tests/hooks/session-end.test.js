import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

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

function runHook(stdinData, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK_PATH], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
    child.on('error', reject);

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

function readQueueFiles(cacheDir) {
  const dir = join(cacheDir, 'pending-conversations');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json') && !n.endsWith('.tmp'))
    .map((name) => ({
      name,
      payload: JSON.parse(readFileSync(join(dir, name), 'utf8')),
    }));
}

describe('session-end hook', () => {
  describe('with valid transcript file (queue-file contract)', () => {
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

    it('writes a queue file with the filtered transcript', async () => {
      const input = makeInput({ transcript_path: transcriptFile });
      const { exitCode } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
      });

      expect(exitCode).toBe(0);
      const files = readQueueFiles(cacheDir);
      expect(files).toHaveLength(1);
      expect(files[0].name.startsWith('test-session-123-')).toBe(true);
      expect(files[0].payload.sessionId).toBe('test-session-123');
      expect(files[0].payload.filteredTranscript).toBe(MOCK_TRANSCRIPT);
    });

    it('filters sensitive data before writing to queue', async () => {
      const sensitiveTranscript = '{"content":"key is sk-abcdefghijklmnopqrstuvwxyz1234567890abcd"}\n';
      const sensitiveFile = transcriptFile + '.sensitive';
      writeFileSync(sensitiveFile, sensitiveTranscript, 'utf8');

      const input = makeInput({ transcript_path: sensitiveFile });
      const { exitCode } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
      });

      expect(exitCode).toBe(0);
      const files = readQueueFiles(cacheDir);
      expect(files[0].payload.filteredTranscript).toContain('[REDACTED_API_KEY]');
      expect(files[0].payload.filteredTranscript).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');

      try { unlinkSync(sensitiveFile); } catch {}
    });

    it('records source "stop" and pluginVersion in queue payload', async () => {
      const input = makeInput({ transcript_path: transcriptFile });
      await runHook(input, {
        CLAUDE_PLUGIN_OPTION_CACHEDIR: cacheDir,
      });

      const files = readQueueFiles(cacheDir);
      expect(files[0].payload.source).toBe('stop');
      expect(typeof files[0].payload.pluginVersion).toBe('string');
      expect(files[0].payload.enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('error handling', () => {
    it('exits 0 when transcript_path is missing', async () => {
      const input = makeInput({ transcript_path: undefined });
      const { exitCode, stderr } = await runHook(input);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('jarvis.session-end.skip');
    });

    it('exits 0 when transcript file does not exist', async () => {
      const input = makeInput({ transcript_path: '/tmp/nonexistent-file-xyz.jsonl' });
      const { exitCode, stderr } = await runHook(input);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('jarvis.session-end.skip');
    });

    it('exits 0 even with no network access (queue write only)', async () => {
      const tmpDir = join(tmpdir(), `jarvis-cache-network-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const tmpFile = join(tmpDir, 'transcript.jsonl');
      writeFileSync(tmpFile, '{"type":"human"}\n', 'utf8');

      const input = makeInput({ transcript_path: tmpFile });
      const { exitCode } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_CACHEDIR: tmpDir,
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://localhost:19999',
      });
      expect(exitCode).toBe(0);

      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
  });
});
