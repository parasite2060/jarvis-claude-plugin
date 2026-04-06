import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
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

describe('session-end hook', () => {
  describe('with valid transcript file and mock server', () => {
    let mockServer;
    let serverPort;
    let transcriptFile;
    let receivedBody;

    const MOCK_TRANSCRIPT = '{"type":"human","message":{"role":"user","content":"Fix the bug"}}\n{"type":"assistant","message":{"role":"assistant","content":"I will fix it"}}\n';

    beforeAll(async () => {
      // Create a temp transcript file
      const tmpDir = join(tmpdir(), 'jarvis-test-session-end');
      mkdirSync(tmpDir, { recursive: true });
      transcriptFile = join(tmpDir, 'transcript.jsonl');
      writeFileSync(transcriptFile, MOCK_TRANSCRIPT, 'utf8');

      // Start mock server
      await new Promise((resolve) => {
        mockServer = createServer((req, res) => {
          if (req.url === '/conversations' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              receivedBody = JSON.parse(body);
              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ data: { transcriptId: 1 }, status: 'ok' }));
            });
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        mockServer.listen(0, '127.0.0.1', () => {
          serverPort = mockServer.address().port;
          resolve();
        });
      });
    });

    afterAll(() => {
      mockServer.close();
      try { unlinkSync(transcriptFile); } catch {}
    });

    beforeEach(() => {
      receivedBody = null;
    });

    it('reads transcript file and sends content to server', async () => {
      const input = makeInput({ transcript_path: transcriptFile });
      const { exitCode } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${serverPort}`,
      });

      expect(exitCode).toBe(0);
      expect(receivedBody).not.toBeNull();
      expect(receivedBody.transcript).toBe(MOCK_TRANSCRIPT);
      expect(receivedBody.sessionId).toBe('test-session-123');
    });

    it('filters sensitive data before sending', async () => {
      const sensitiveTranscript = '{"content":"key is sk-abcdefghijklmnopqrstuvwxyz1234567890abcd"}\n';
      const sensitiveFile = transcriptFile + '.sensitive';
      writeFileSync(sensitiveFile, sensitiveTranscript, 'utf8');

      const input = makeInput({ transcript_path: sensitiveFile });
      const { exitCode } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${serverPort}`,
      });

      expect(exitCode).toBe(0);
      expect(receivedBody.transcript).toContain('[REDACTED_API_KEY]');
      expect(receivedBody.transcript).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');

      try { unlinkSync(sensitiveFile); } catch {}
    });

    it('sends source: "stop" in POST body', async () => {
      const input = makeInput({ transcript_path: transcriptFile });
      await runHook(input, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${serverPort}`,
      });

      expect(receivedBody.source).toBe('stop');
    });
  });

  describe('error handling', () => {
    it('exits 0 when transcript_path is missing', async () => {
      const input = makeInput({ transcript_path: undefined });
      const { exitCode, stderr } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://localhost:19999',
      });
      expect(exitCode).toBe(0);
      expect(stderr).toContain('jarvis.session-end.skip');
    });

    it('exits 0 when transcript file does not exist', async () => {
      const input = makeInput({ transcript_path: '/tmp/nonexistent-file-xyz.jsonl' });
      const { exitCode, stderr } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://localhost:19999',
      });
      expect(exitCode).toBe(0);
      expect(stderr).toContain('jarvis.session-end.skip');
    });

    it('exits 0 when server is unreachable', async () => {
      const tmpDir = join(tmpdir(), 'jarvis-test-session-end');
      mkdirSync(tmpDir, { recursive: true });
      const tmpFile = join(tmpDir, 'unreachable-test.jsonl');
      writeFileSync(tmpFile, '{"type":"human"}\n', 'utf8');

      const input = makeInput({ transcript_path: tmpFile });
      const { exitCode } = await runHook(input, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://localhost:19999',
      });
      expect(exitCode).toBe(0);

      try { unlinkSync(tmpFile); } catch {}
    });
  });
});
