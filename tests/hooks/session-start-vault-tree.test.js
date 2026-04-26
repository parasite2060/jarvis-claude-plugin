import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-start-vault-tree.js');

const MOCK_INPUT = JSON.stringify({
  session_id: 'test-session-tree',
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

function makeManifestServer(files) {
  const server = createServer((req, res) => {
    if (req.url === '/memory/files/manifest' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        data: {
          files,
          manifestHash: 'h',
          fileCount: files.length,
          generatedAt: '2026-04-26T10:00:00+00:00',
        },
      }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  return server;
}

describe('session-start-vault-tree hook', () => {
  describe('when server unreachable', () => {
    it('exits 0 with empty additionalContext and emits no stack trace', async () => {
      const { stdout, stderr, exitCode } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19995',
      });
      expect(exitCode).toBe(0);
      const output = JSON.parse(stdout);
      // With no manifest data, emit only JARVIS_CACHE_DIR pointer
      expect(output.hookSpecificOutput.additionalContext).toMatch(/JARVIS_CACHE_DIR:/);
      // No V8 stack trace leaked
      expect(stderr).not.toContain('    at ');
    });
  });

  describe('when stdin is invalid JSON', () => {
    it('still emits valid JSON with empty additionalContext, exits 0', async () => {
      const { stdout, stderr, exitCode } = await runHook('not-valid-json{', {
        CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19995',
      });
      expect(exitCode).toBe(0);
      // stdout must still be parseable
      const output = JSON.parse(stdout);
      expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(output.hookSpecificOutput.additionalContext).toBe('');
      // error label appears in stderr
      expect(stderr).toContain('jarvis.session-start-vault-tree.error:');
      // no V8 stack trace leaked
      expect(stderr).not.toContain('    at ');
    });
  });

  describe('with manifest', () => {
    let server;
    let port;
    const HOT_FILES = [
      // decisions: 6 files, 5 most-recent should appear
      { path: 'decisions/d1.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
      { path: 'decisions/d2.md', hash: 'a', size: 1, updatedAt: '2026-04-25T10:00:00+00:00' },
      { path: 'decisions/d3.md', hash: 'a', size: 1, updatedAt: '2026-04-24T10:00:00+00:00' },
      { path: 'decisions/d4.md', hash: 'a', size: 1, updatedAt: '2026-04-23T10:00:00+00:00' },
      { path: 'decisions/d5.md', hash: 'a', size: 1, updatedAt: '2026-04-22T10:00:00+00:00' },
      { path: 'decisions/d6_old.md', hash: 'a', size: 1, updatedAt: '2026-04-01T10:00:00+00:00' },
      { path: 'decisions/_index.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
      // cold folder: dailys (3 files)
      { path: 'dailys/2026-04-26.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
      { path: 'dailys/2026-04-25.md', hash: 'a', size: 1, updatedAt: '2026-04-25T10:00:00+00:00' },
      { path: 'dailys/2026-04-24.md', hash: 'a', size: 1, updatedAt: '2026-04-24T10:00:00+00:00' },
      // root files
      { path: 'SOUL.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
      { path: 'IDENTITY.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
      { path: 'MEMORY.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
    ];

    beforeAll(async () => {
      server = makeManifestServer(HOT_FILES);
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      port = server.address().port;
    });

    afterAll(() => { server.close(); });

    it('lists 5 most-recent files for hot folder decisions/', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toContain('decisions/');
      expect(ctx).toContain('d1.md');
      expect(ctx).toContain('d2.md');
      expect(ctx).toContain('d3.md');
      expect(ctx).toContain('d4.md');
      expect(ctx).toContain('d5.md');
      // 6th-oldest must NOT appear
      expect(ctx).not.toContain('d6_old.md');
      // _index.md never listed as a leaf
      expect(ctx).not.toMatch(/├── _index\.md/);
    });

    it('shows count + read-_index.md hint for cold folder dailys/', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toMatch(/dailys\/\s+\(3 files/);
      expect(ctx).toMatch(/dailys.*read _index\.md/);
      expect(ctx).not.toContain('2026-04-25.md'); // cold = no leaves
    });

    it('includes JARVIS_CACHE_DIR header', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toMatch(/JARVIS_CACHE_DIR: /);
    });

    it('lists root files inline', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toContain('SOUL.md');
      expect(ctx).toContain('IDENTITY.md');
      expect(ctx).toContain('MEMORY.md');
    });

    it('output stays under 10K chars', async () => {
      const { stdout } = await runHook(MOCK_INPUT, {
        CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      });
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      expect(ctx.length).toBeLessThan(10_000);
    });
  });
});
