/**
 * SessionStart hook — injects vault navigation tree into Claude's session.
 * Hot folders get their 5 most-recent files; cold folders get count + hint.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { join } from 'node:path';
import { getFileManifest, config } from './lib/jarvis-client.js';
import { readStdin } from './lib/read-stdin.js';
import { resolveHome } from '../lib/paths.js';

const HOT_FOLDERS = ['concepts', 'decisions', 'lessons', 'patterns', 'projects', 'references'];
const RECENT_LIMIT = 5;
const HOOK_EVENT_NAME = 'SessionStart';

const PREFACE = (
  "Below is the operator's vault map. Read `<folder>/_index.md` for full file " +
  "catalogs; specific files via Read on JARVIS_CACHE_DIR.\n\n"
);

function resolveCacheDir() {
  return resolveHome(config.cacheDir || '~/.jarvis-cache/ai-memory');
}

/**
 * Group manifest files by top-level folder. Root files (no slash) go in '_root'.
 * Skips _index.md from leaf listings (it's referenced separately).
 */
function groupByFolder(files) {
  const groups = { _root: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) {
      groups._root.push(file);
      continue;
    }
    const folder = parts[0];
    if (!groups[folder]) groups[folder] = [];
    if (parts[parts.length - 1] !== '_index.md') {
      groups[folder].push(file);
    }
  }
  return groups;
}

function renderHotFolder(folder, files, folderConnector, childPrefix) {
  const recent = [...files]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT);
  const lines = [`${folderConnector}${folder}/      (${files.length} files)`];
  for (let j = 0; j < recent.length; j++) {
    const isLastFile = j === recent.length - 1;
    const fileConnector = isLastFile ? '└── ' : '├── ';
    const filename = recent[j].path.split('/').pop();
    lines.push(`${childPrefix}${fileConnector}${filename}`);
  }
  return lines;
}

function renderColdFolder(folder, files, folderConnector) {
  const noun = files.length === 1 ? 'file' : 'files';
  return [`${folderConnector}${folder}/   (${files.length} ${noun} — read _index.md)`];
}

function renderTree(groups) {
  const folders = Object.keys(groups).filter((k) => k !== '_root').sort();
  const lines = ['Vault tree (5 most-recent per hot folder; read <folder>/_index.md for the full catalog):'];

  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const isLastFolder = i === folders.length - 1;
    const folderConnector = isLastFolder ? '└── ' : '├── ';
    const childPrefix = isLastFolder ? '    ' : '│   ';
    const renderer = HOT_FOLDERS.includes(folder) ? renderHotFolder : renderColdFolder;
    lines.push(...renderer(folder, groups[folder], folderConnector, childPrefix));
  }

  if (groups._root.length > 0) {
    const rootNames = groups._root.map((f) => f.path).sort().join(', ');
    lines.push('');
    lines.push(`Root: ${rootNames}`);
  }

  return lines.join('\n');
}

function buildBody(cacheDir, files) {
  let body = `JARVIS_CACHE_DIR: ${cacheDir}\n`;
  if (files.length > 0) {
    body += `\n${PREFACE}${renderTree(groupByFolder(files))}`;
  }
  return body;
}

function emitContext(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: HOOK_EVENT_NAME, additionalContext },
  }));
}

async function main(raw) {
  JSON.parse(raw);
  const files = await getFileManifest();
  const body = buildBody(resolveCacheDir(), files);
  emitContext(`<vault>\n${body}\n</vault>`);
}

const raw = await readStdin();

try {
  await main(raw);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start-vault-tree.error: ${message}\n`);
  emitContext('');
}
