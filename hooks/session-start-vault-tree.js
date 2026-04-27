/**
 * SessionStart hook — injects vault navigation tree into Claude's session.
 * Hot folders get their 5 most-recent files; cold folders get count + hint.
 * One of four split handlers; each must stay under Claude Code's 10K-char hook cap.
 * ALWAYS exits 0. Never blocks Claude Code.
 */

import { getFileManifest, config } from './lib/jarvis-client.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOT_FOLDERS = ['concepts', 'decisions', 'lessons', 'patterns', 'projects', 'references'];
const RECENT_LIMIT = 5;

const PREFACE = (
  "Below is the operator's vault map. Read `<folder>/_index.md` for full file " +
  "catalogs; specific files via Read on JARVIS_CACHE_DIR.\n\n"
);

function resolveCacheDir() {
  const dir = config.cacheDir || '~/.jarvis-cache/ai-memory';
  return dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
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

function renderTree(groups) {
  const folders = Object.keys(groups).filter((k) => k !== '_root').sort();
  const lines = ['Vault tree (5 most-recent per hot folder; read <folder>/_index.md for the full catalog):'];

  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const isLastFolder = i === folders.length - 1;
    const folderConnector = isLastFolder ? '└── ' : '├── ';
    const childPrefix = isLastFolder ? '    ' : '│   ';
    const files = groups[folder];
    const count = files.length;

    if (HOT_FOLDERS.includes(folder)) {
      // Sort by mtime desc, take top 5
      const recent = [...files]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, RECENT_LIMIT);
      lines.push(`${folderConnector}${folder}/      (${count} files)`);
      for (let j = 0; j < recent.length; j++) {
        const isLastFile = j === recent.length - 1;
        const fileConnector = isLastFile ? '└── ' : '├── ';
        const filename = recent[j].path.split('/').pop();
        lines.push(`${childPrefix}${fileConnector}${filename}`);
      }
    } else {
      // Cold folder: count + hint
      lines.push(`${folderConnector}${folder}/   (${count} file${count === 1 ? '' : 's'} — read _index.md)`);
    }
  }

  if (groups._root.length > 0) {
    const rootNames = groups._root.map((f) => f.path).sort().join(', ');
    lines.push('');
    lines.push(`Root: ${rootNames}`);
  }

  return lines.join('\n');
}

const raw = await readStdin();

try {
  JSON.parse(raw);
  const cacheDir = resolveCacheDir();
  const files = await getFileManifest();

  let body = `JARVIS_CACHE_DIR: ${cacheDir}\n`;
  if (files.length > 0) {
    const groups = groupByFolder(files);
    body += `\n${PREFACE}${renderTree(groups)}`;
  }
  const additionalContext = `<vault>\n${body}\n</vault>`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`jarvis.session-start-vault-tree.error: ${message}\n`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
  }));
}
