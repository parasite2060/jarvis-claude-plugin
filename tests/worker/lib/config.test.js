import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'CLAUDE_PLUGIN_OPTION_SERVERURL',
  'CLAUDE_PLUGIN_OPTION_APIKEY',
  'CLAUDE_PLUGIN_OPTION_CACHEDIR',
  'CLAUDE_PLUGIN_OPTION_WORKERPORT',
  'CLAUDE_PLUGIN_OPTION_EXTRAHEADERS',
  'CLAUDE_PLUGIN_OPTION_IDLEMS',
  'CLAUDE_PLUGIN_OPTION_IDLECHECKMS',
];

describe('loadWorkerConfig', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('should return defaults when no env vars are set', async () => {
    // Arrange
    const { loadWorkerConfig } = await import('../../../worker/lib/config.js');

    // Act
    const config = loadWorkerConfig();

    // Assert
    expect(config.serverUrl).toBe('http://localhost:8000');
    expect(config.apiKey).toBeUndefined();
    expect(config.workerPort).toBe(37777);
    expect(config.extraHeaders).toEqual({});
    expect(config.syncIntervalMs).toBe(5 * 60 * 1000);
    expect(config.drainIntervalMs).toBe(30 * 1000);
    expect(config.idleTimeoutMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.idleCheckIntervalMs).toBe(60 * 60 * 1000);
    expect(typeof config.pluginVersion).toBe('string');
    expect(config.pluginVersion.length).toBeGreaterThan(0);
    expect(typeof config.pluginRoot).toBe('string');
  });

  it('should override serverUrl, apiKey, port, and intervals when env vars are set', async () => {
    // Arrange
    process.env.CLAUDE_PLUGIN_OPTION_SERVERURL = 'http://example.com';
    process.env.CLAUDE_PLUGIN_OPTION_APIKEY = 'secret-key';
    process.env.CLAUDE_PLUGIN_OPTION_WORKERPORT = '12345';
    process.env.CLAUDE_PLUGIN_OPTION_IDLEMS = '500';
    process.env.CLAUDE_PLUGIN_OPTION_IDLECHECKMS = '100';
    const { loadWorkerConfig } = await import('../../../worker/lib/config.js');

    // Act
    const config = loadWorkerConfig();

    // Assert
    expect(config.serverUrl).toBe('http://example.com');
    expect(config.apiKey).toBe('secret-key');
    expect(config.workerPort).toBe(12345);
    expect(config.idleTimeoutMs).toBe(500);
    expect(config.idleCheckIntervalMs).toBe(100);
  });

  it('should parse extraHeaders JSON when CLAUDE_PLUGIN_OPTION_EXTRAHEADERS is set', async () => {
    // Arrange
    process.env.CLAUDE_PLUGIN_OPTION_EXTRAHEADERS = '{"X-Auth":"abc"}';
    const { loadWorkerConfig } = await import('../../../worker/lib/config.js');

    // Act
    const config = loadWorkerConfig();

    // Assert
    expect(config.extraHeaders).toEqual({ 'X-Auth': 'abc' });
  });

  it('should return a frozen object when called', async () => {
    // Arrange
    const { loadWorkerConfig } = await import('../../../worker/lib/config.js');

    // Act
    const config = loadWorkerConfig();

    // Assert
    expect(Object.isFrozen(config)).toBe(true);
  });
});
