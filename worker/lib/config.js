/**
 * Worker config: pure parsing of env vars + plugin metadata.
 * The worker entry point reads this once at boot, then operates on a frozen
 * config object — no further env access in the rest of server.js.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHome, isUnsetPath } from '../../lib/paths.js';
import { parseExtraHeaders } from '../../hooks/lib/parse-extra-headers.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_IDLE_MS = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..');

function readPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envPath(name, fallback) {
  const raw = process.env[name];
  return resolveHome(isUnsetPath(raw) ? fallback : raw);
}

export function loadWorkerConfig() {
  const cacheDir = envPath('CLAUDE_PLUGIN_OPTION_CACHEDIR', '~/.jarvis-cache/ai-memory');
  const workerDir = envPath('CLAUDE_PLUGIN_OPTION_WORKERDIR', '~/.jarvis-cache/worker');

  return Object.freeze({
    pluginVersion: readPluginVersion(),
    pluginRoot: PLUGIN_ROOT,
    serverUrl: process.env.CLAUDE_PLUGIN_OPTION_SERVERURL || 'http://localhost:8000',
    apiKey: process.env.CLAUDE_PLUGIN_OPTION_APIKEY,
    cacheDir,
    workerDir,
    workerPort: envNumber('CLAUDE_PLUGIN_OPTION_WORKERPORT', 37777),
    extraHeaders: parseExtraHeaders(process.env.CLAUDE_PLUGIN_OPTION_EXTRAHEADERS || ''),
    syncIntervalMs: 5 * 60 * 1000,
    drainIntervalMs: 30 * 1000,
    idleTimeoutMs: Math.max(MIN_IDLE_MS, envNumber('CLAUDE_PLUGIN_OPTION_IDLEMS', SEVEN_DAYS_MS)),
    idleCheckIntervalMs: Math.max(MIN_IDLE_MS, envNumber('CLAUDE_PLUGIN_OPTION_IDLECHECKMS', 60 * 60 * 1000)),
  });
}
