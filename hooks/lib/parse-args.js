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

// Claude Code occasionally propagates the literal string "undefined" for
// unconfigured plugin envs; treat it (and "", "null", ".") as unset.
const SENTINEL_UNSET = new Set(['', '.', 'undefined', 'null']);

function pathArg(envKey, cliKey, fallback, cliArgs) {
  const raw = env(envKey) ?? cliArgs[cliKey];
  if (typeof raw !== 'string' || SENTINEL_UNSET.has(raw.trim())) return fallback;
  return raw;
}

export function parseArgs() {
  const cliArgs = parseCliArgs();

  return {
    serverUrl: env('serverUrl') || cliArgs.serverUrl || 'http://localhost:8000',
    apiKey: env('apiKey') || cliArgs.apiKey || '',
    cacheDir: pathArg('cacheDir', 'cacheDir', '~/.jarvis-cache/ai-memory', cliArgs),
    workerDir: pathArg('workerDir', 'workerDir', '~/.jarvis-cache/worker', cliArgs),
    workerPort: Number(env('workerPort') || cliArgs.workerPort) || 37777,
    extraHeaders: env('extraHeaders') || cliArgs.extraHeaders || '',
    fetchTimeoutMs: Number(env('fetchTimeoutMs') || cliArgs.fetchTimeoutMs) || 180_000,
  };
}
