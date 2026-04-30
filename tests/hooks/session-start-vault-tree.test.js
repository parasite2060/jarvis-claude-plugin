import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runHook } from '../helpers/run-hook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-start-vault-tree.js');

const MOCK_INPUT = JSON.stringify({
  session_id: 'test-session-tree',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp',
  hook_event_name: 'SessionStart',
});

function makeManifestServer(files) {
  return createServer((req, res) => {
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
}

describe('session-start-vault-tree hook > when server unreachable', () => {
  it('should exit 0 with <vault>-wrapped JARVIS_CACHE_DIR and no stack trace when manifest fetch fails', async () => {
    // Act
    const { stdout, stderr, exitCode } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19995',
    });

    // Assert
    expect(exitCode).toBe(0);
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('<vault>');
    expect(ctx).toContain('</vault>');
    expect(ctx).toMatch(/JARVIS_CACHE_DIR:/);
    expect(stderr).not.toContain('    at ');
  });
});

describe('session-start-vault-tree hook > when stdin is invalid JSON', () => {
  it('should exit 0 with empty additionalContext when stdin cannot be parsed', async () => {
    // Act
    const { stdout, stderr, exitCode } = await runHook(HOOK_PATH, 'not-valid-json{', {
      CLAUDE_PLUGIN_OPTION_SERVERURL: 'http://127.0.0.1:19995',
    });

    // Assert
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
    });
    expect(stderr).toContain('jarvis.session-start-vault-tree.error:');
    expect(stderr).not.toContain('    at ');
  });
});

describe('session-start-vault-tree hook > with manifest', () => {
  let server;
  let port;
  const HOT_FILES = [
    { path: 'decisions/d1.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
    { path: 'decisions/d2.md', hash: 'a', size: 1, updatedAt: '2026-04-25T10:00:00+00:00' },
    { path: 'decisions/d3.md', hash: 'a', size: 1, updatedAt: '2026-04-24T10:00:00+00:00' },
    { path: 'decisions/d4.md', hash: 'a', size: 1, updatedAt: '2026-04-23T10:00:00+00:00' },
    { path: 'decisions/d5.md', hash: 'a', size: 1, updatedAt: '2026-04-22T10:00:00+00:00' },
    { path: 'decisions/d6_old.md', hash: 'a', size: 1, updatedAt: '2026-04-01T10:00:00+00:00' },
    { path: 'decisions/_index.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
    { path: 'dailys/2026-04-26.md', hash: 'a', size: 1, updatedAt: '2026-04-26T10:00:00+00:00' },
    { path: 'dailys/2026-04-25.md', hash: 'a', size: 1, updatedAt: '2026-04-25T10:00:00+00:00' },
    { path: 'dailys/2026-04-24.md', hash: 'a', size: 1, updatedAt: '2026-04-24T10:00:00+00:00' },
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

  async function fetchVaultContext() {
    const { stdout } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
      CLAUDE_PLUGIN_OPTION_CACHEDIR: '/tmp/test-vault-cache',
    });
    return JSON.parse(stdout).hookSpecificOutput.additionalContext;
  }

  it('should render the full vault tree with hot folders, cold folders, and root files when manifest is provided', async () => {
    // Act
    const ctx = await fetchVaultContext();

    // Assert
    expect(ctx).toMatchInlineSnapshot(`
      "<vault>
      JARVIS_CACHE_DIR: /tmp/test-vault-cache

      Below is the operator's vault map. Read \`<folder>/_index.md\` for full file catalogs; specific files via Read on JARVIS_CACHE_DIR.

      Vault tree (5 most-recent per hot folder; read <folder>/_index.md for the full catalog):
      ├── dailys/   (3 files — read _index.md)
      └── decisions/      (6 files)
          ├── d1.md
          ├── d2.md
          ├── d3.md
          ├── d4.md
          └── d5.md

      Root: IDENTITY.md, MEMORY.md, SOUL.md
      </vault>"
    `);
  });

  it('should keep output under 10K chars when manifest is provided', async () => {
    // Act
    const ctx = await fetchVaultContext();

    // Assert
    expect(ctx.length).toBeLessThan(10_000);
  });
});
