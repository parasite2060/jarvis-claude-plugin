import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runHook } from '../helpers/run-hook.js';
import { startMemoryDocServer } from '../helpers/context-section-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-start-memory.js');

const MOCK_INPUT = JSON.stringify({
  session_id: 'test-session-memory',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp',
  hook_event_name: 'SessionStart',
});

const UNREACHABLE_URL = 'http://127.0.0.1:19996';

describe('session-start-memory hook > when server unreachable', () => {
  it('should exit 0 with empty additionalContext and no stack trace when server is down', async () => {
    // Act
    const { stdout, stderr, exitCode } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: UNREACHABLE_URL,
    });

    // Assert
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('    at ');
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
    });
  });
});

describe('session-start-memory hook > when stdin is invalid JSON', () => {
  it('should exit 0 with empty additionalContext when stdin cannot be parsed', async () => {
    // Act
    const { stdout, exitCode, stderr } = await runHook(HOOK_PATH, 'not-valid-json{', {
      CLAUDE_PLUGIN_OPTION_SERVERURL: UNREACHABLE_URL,
    });

    // Assert
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
    });
    expect(stderr).toContain('jarvis.session-start-memory.error:');
    expect(stderr).not.toContain('    at ');
  });
});

describe('session-start-memory hook > when server returns MEMORY.md', () => {
  let server;
  let port;
  const MOCK_MEMORY = '# Memory\n\n## Strong Patterns\n- Pattern A\n- Pattern B';

  beforeAll(async () => {
    ({ server, port } = await startMemoryDocServer({
      endpoint: '/memory/memory',
      content: MOCK_MEMORY,
      filePath: 'MEMORY.md',
    }));
  });

  afterAll(() => { server.close(); });

  it('should emit framing preface plus <memory>-wrapped content when server returns memory', async () => {
    // Act
    const { stdout, exitCode } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
    });

    // Assert
    expect(exitCode).toBe(0);
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('<memory>');
    expect(ctx).toContain('</memory>');
    expect(ctx).toContain(MOCK_MEMORY);
    expect(ctx).toMatch(/operator/i);
    expect(ctx.indexOf('operator')).toBeLessThan(ctx.indexOf('<memory>'));
  });

  it('should keep output under 10K chars when server returns memory', async () => {
    // Act
    const { stdout } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
    });

    // Assert
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeLessThan(10_000);
    expect(ctx.length).toBeGreaterThanOrEqual(MOCK_MEMORY.length + 100);
  });
});
