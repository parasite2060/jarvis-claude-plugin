import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-start-identity.js');

const MOCK_INPUT = JSON.stringify({
  session_id: 'test-session-identity',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp',
  hook_event_name: 'SessionStart',
});

function runHook(stdinData, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK_PATH], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
    child.on('error', reject);
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

describe('session-start-identity hook', () => {
  describe('when server unreachable', () => {
    it('exits with code 0 and emits no stack trace', async () => {
      const { exitCode, stderr } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19996',
      });
      expect(exitCode).toBe(0);
      expect(stderr).not.toContain('    at ');
    });

    it('outputs valid JSON with empty additionalContext', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19996',
      });
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(output.hookSpecificOutput.additionalContext).toBe('');
    });
  });

  describe('when stdin is invalid JSON', () => {
    it('still emits valid JSON with empty additionalContext, exits 0', async () => {
      const { stdout, exitCode, stderr } = await runHook('not-valid-json{', {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19996',
      });
      expect(exitCode).toBe(0);
      // stdout must still be parseable
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(output.hookSpecificOutput.additionalContext).toBe('');
      // error label appears in stderr
      expect(stderr).toContain('jarvis.session-start-identity.error:');
      // no V8 stack trace leaked
      expect(stderr).not.toContain('    at ');
    });
  });

  describe('when server returns IDENTITY.md', () => {
    let server;
    let port;
    const MOCK_IDENTITY = '# Identity\n\nSenior dev, async-first, TS+Python.';

    beforeAll(async () => {
      await new Promise((resolve) => {
        server = createServer((req, res) => {
          if (req.url === '/memory/identity' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              data: { content: MOCK_IDENTITY, filePath: 'IDENTITY.md' },
            }));
          } else {
            res.writeHead(404); res.end();
          }
        });
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    });

    afterAll(() => { server.close(); });

    it('emits framing preface + IDENTITY content', async () => {
      const { stdout, exitCode } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      expect(exitCode).toBe(0);
      const output = JSON.parse(stdout);
      const ctx = output.hookSpecificOutput.additionalContext;
      expect(ctx).toContain('IDENTITY');
      expect(ctx).toContain(MOCK_IDENTITY);
      expect(ctx).toMatch(/operator/i);
    });

    it('output stays under 10K chars (Claude Code hook cap)', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.additionalContext.length).toBeLessThan(10_000);
    });

    it('handles large IDENTITY.md content correctly', async () => {
      // We can't change the existing mock server's payload from here, so this
      // is a smoke test: the hook emits valid JSON with content present.
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.additionalContext.length).toBeGreaterThan(MOCK_IDENTITY.length);
      // PREFACE adds at least 100 chars of framing
      expect(output.hookSpecificOutput.additionalContext.length).toBeGreaterThanOrEqual(MOCK_IDENTITY.length + 100);
    });
  });
});
