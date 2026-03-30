import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-start.js');

const MOCK_INPUT = JSON.stringify({
  session_id: 'test-session-123',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp',
  hook_event_name: 'SessionStart',
});

/**
 * Spawns the session-start hook with given stdin and env, collects stdout + exit code.
 * @param {string} stdinData
 * @param {Record<string, string>} env
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
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

describe('session-start hook', () => {
  describe('when Jarvis server is unreachable', () => {
    it('exits with code 0', async () => {
      const { exitCode } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_serverUrl: 'http://localhost:19999',
      });
      expect(exitCode).toBe(0);
    });

    it('outputs valid JSON', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_serverUrl: 'http://localhost:19999',
      });
      expect(() => JSON.parse(stdout)).not.toThrow();
    });

    it('outputs hookSpecificOutput.additionalContext as a string', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_serverUrl: 'http://localhost:19999',
      });
      const output = JSON.parse(stdout);
      expect(output).toHaveProperty('hookSpecificOutput');
      expect(output.hookSpecificOutput).toHaveProperty('additionalContext');
      expect(typeof output.hookSpecificOutput.additionalContext).toBe('string');
    });

    it('outputs empty additionalContext on failure', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_serverUrl: 'http://localhost:19999',
      });
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.additionalContext).toBe('');
    });
  });

  describe('when Jarvis server returns context', () => {
    let mockServer;
    let serverPort;
    const MOCK_CONTEXT = 'You are working on Project Jarvis. Key facts: TypeScript strict mode.';

    beforeAll(async () => {
      await new Promise((resolve) => {
        mockServer = createServer((req, res) => {
          if (req.url === '/memory/context' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: MOCK_CONTEXT, status: 'ok' }));
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
    });

    it('exits with code 0', async () => {
      const { exitCode } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_serverUrl: `http://127.0.0.1:${serverPort}`,
      });
      expect(exitCode).toBe(0);
    });

    it('outputs valid JSON with additionalContext from server', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_serverUrl: `http://127.0.0.1:${serverPort}`,
      });
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.additionalContext).toBe(MOCK_CONTEXT);
    });
  });
});
