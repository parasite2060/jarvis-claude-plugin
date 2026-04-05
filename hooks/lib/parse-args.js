/**
 * Reads plugin config from Claude Code's config files directly.
 * Falls back to CLI args and env vars for manual testing.
 *
 * Config sources (in priority order):
 * 1. Claude Code settings.json (pluginConfigs) + .credentials.json (pluginSecrets)
 * 2. CLI args (--server-url, --api-key, etc.)
 * 3. CLAUDE_PLUGIN_OPTION_* env vars
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PLUGIN_ID = 'jarvis-plugin@jarvis';

function readClaudeConfig() {
  try {
    const claudeDir = join(homedir(), '.claude');

    // Read non-sensitive options from settings.json
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    const options = settings?.pluginConfigs?.[PLUGIN_ID]?.options ?? {};

    // Read sensitive options from .credentials.json
    const creds = JSON.parse(readFileSync(join(claudeDir, '.credentials.json'), 'utf8'));
    const secrets = creds?.pluginSecrets?.[PLUGIN_ID] ?? {};

    return { ...options, ...secrets };
  } catch {
    return null;
  }
}

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

export function parseArgs() {
  // Try Claude Code config files first
  const claudeConfig = readClaudeConfig();

  // CLI args as fallback (for manual testing)
  const cliArgs = parseCliArgs();

  // Merge: Claude config > CLI args > env vars > defaults
  return {
    serverUrl: claudeConfig?.serverUrl || cliArgs.serverUrl || process.env.CLAUDE_PLUGIN_OPTION_serverUrl || 'http://localhost:8000',
    apiKey: claudeConfig?.apiKey || cliArgs.apiKey || process.env.CLAUDE_PLUGIN_OPTION_apiKey || '',
    cacheDir: claudeConfig?.cacheDir || cliArgs.cacheDir || process.env.CLAUDE_PLUGIN_OPTION_cacheDir || '~/.jarvis-cache/ai-memory',
    workerPort: Number(claudeConfig?.workerPort || cliArgs.workerPort || process.env.CLAUDE_PLUGIN_OPTION_workerPort) || 37777,
    extraHeaders: claudeConfig?.extraHeaders || cliArgs.extraHeaders || process.env.CLAUDE_PLUGIN_OPTION_extraHeaders || '',
  };
}
