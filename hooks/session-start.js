/**
 * SessionStart hook — injects Jarvis memory context into Claude's session.
 * Reads stdin JSON, calls GET /memory/context, outputs hookSpecificOutput.additionalContext.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getContext, get, config } from './lib/jarvis-client.js';
import { ensureWorkerRunning } from './lib/worker-manager.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

function resolveCacheDir() {
  const dir = config.cacheDir || '~/.jarvis-cache/ai-memory';
  return dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir;
}

async function getFileIndex() {
  const data = await get('/memory/files/manifest');
  if (!data?.data?.files) return '';
  const files = data.data.files;

  // Build a nested tree structure
  const tree = {};
  for (const f of files) {
    const parts = f.path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = null; // leaf file
  }

  function renderTree(node, prefix = '') {
    const entries = Object.keys(node).sort((a, b) => {
      const aIsDir = node[a] !== null;
      const bIsDir = node[b] !== null;
      if (aIsDir !== bIsDir) return aIsDir ? 1 : -1; // files first
      return a.localeCompare(b);
    });
    const lines = [];
    for (let i = 0; i < entries.length; i++) {
      const name = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const isDir = node[name] !== null;
      lines.push(`${prefix}${connector}${name}${isDir ? '/' : ''}`);
      if (isDir) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        lines.push(...renderTree(node[name], childPrefix));
      }
    }
    return lines;
  }

  return renderTree(tree).join('\n');
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

const raw = await readStdin();

try {
  JSON.parse(raw);
  const [context, fileIndex] = await Promise.all([getContext(), getFileIndex()]);
  const cacheDir = resolveCacheDir();
  const header = `JARVIS_CACHE_DIR: ${cacheDir}\n${fileIndex ? `\nVault files:\n${fileIndex}\n` : ''}\n`;

  // Start background file sync worker (non-blocking, fire-and-forget)
  ensureWorkerRunning().catch(() => {});

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: header + (context ?? ''),
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
