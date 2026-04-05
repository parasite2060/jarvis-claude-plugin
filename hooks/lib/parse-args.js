/**
 * Parse --key value CLI args into a config object.
 * Falls back to CLAUDE_PLUGIN_OPTION_* env vars for backward compatibility.
 */
export function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i]
        .slice(2)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // kebab-case to camelCase
      parsed[key] = args[i + 1];
      i++;
    }
  }

  return {
    serverUrl: parsed.serverUrl || process.env.CLAUDE_PLUGIN_OPTION_serverUrl || 'http://localhost:8000',
    apiKey: parsed.apiKey || process.env.CLAUDE_PLUGIN_OPTION_apiKey || '',
    cacheDir: parsed.cacheDir || process.env.CLAUDE_PLUGIN_OPTION_cacheDir || '~/.jarvis-cache/ai-memory',
    workerPort: Number(parsed.workerPort || process.env.CLAUDE_PLUGIN_OPTION_workerPort) || 37777,
    extraHeaders: parsed.extraHeaders || process.env.CLAUDE_PLUGIN_OPTION_extraHeaders || '',
  };
}
