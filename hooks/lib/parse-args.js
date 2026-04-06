/**
 * Reads plugin config for hooks.
 *
 * Config sources (in priority order):
 * 1. CLAUDE_PLUGIN_OPTION_* env vars (set by Claude Code, includes Keychain secrets)
 * 2. CLI args (--server-url, --api-key, etc.) for manual testing
 * 3. Defaults
 */

function parseCliArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      parsed[key] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

function env(key) {
  // Claude Code uppercases keys: serverUrl → CLAUDE_PLUGIN_OPTION_SERVERURL
  return process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
}

export function parseArgs() {
  const cliArgs = parseCliArgs();

  return {
    serverUrl: env('serverUrl') || cliArgs.serverUrl || 'http://localhost:8000',
    apiKey: env('apiKey') || cliArgs.apiKey || '',
    cacheDir: env('cacheDir') || cliArgs.cacheDir || '~/.jarvis-cache/ai-memory',
    workerPort: Number(env('workerPort') || cliArgs.workerPort) || 37777,
    extraHeaders: env('extraHeaders') || cliArgs.extraHeaders || '',
  };
}
