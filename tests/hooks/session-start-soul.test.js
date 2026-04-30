import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runHook } from '../helpers/run-hook.js';
import { startMemoryDocServer } from '../helpers/context-section-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '../../hooks/session-start-soul.js');

const MOCK_INPUT = JSON.stringify({
  session_id: 'test-session-soul',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp',
  hook_event_name: 'SessionStart',
});

const UNREACHABLE_URL = 'http://127.0.0.1:19996';

describe('session-start-soul hook > when server unreachable', () => {
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

describe('session-start-soul hook > when stdin is invalid JSON', () => {
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
    expect(stderr).toContain('jarvis.session-start-soul.error:');
    expect(stderr).not.toContain('    at ');
  });
});

describe('session-start-soul hook > when server returns SOUL.md', () => {
  let server;
  let port;
  const MOCK_SOUL = '# Soul\n\nBe helpful, dry-witted, and concise.';

  beforeAll(async () => {
    ({ server, port } = await startMemoryDocServer({
      endpoint: '/memory/soul',
      content: MOCK_SOUL,
      filePath: 'SOUL.md',
    }));
  });

  afterAll(() => { server.close(); });

  it('should emit framing preface plus <soul>-wrapped content when server returns soul', async () => {
    // Act
    const { stdout, exitCode } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
    });

    // Assert
    expect(exitCode).toBe(0);
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('<soul>');
    expect(ctx).toContain('</soul>');
    expect(ctx).toContain(MOCK_SOUL);
    expect(ctx).toMatch(/operator/i);
    expect(ctx.indexOf('operator')).toBeLessThan(ctx.indexOf('<soul>'));
  });

  it('should keep output under 10K chars when server returns soul', async () => {
    // Act
    const { stdout } = await runHook(HOOK_PATH, MOCK_INPUT, {
      CLAUDE_PLUGIN_OPTION_SERVERURL: `http://127.0.0.1:${port}`,
    });

    // Assert
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeLessThan(10_000);
    expect(ctx.length).toBeGreaterThanOrEqual(MOCK_SOUL.length + 100);
  });
});
