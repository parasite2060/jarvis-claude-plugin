/**
 * Reads all of stdin as a UTF-8 string. Resolves with whatever has arrived
 * once the stream emits 'end' or the timeout fires — whichever comes first.
 *
 * The timeout matters: a parent process that never closes stdin would
 * otherwise hang the hook indefinitely, and Claude Code's hook-cancel
 * window is short.
 */

const DEFAULT_TIMEOUT_MS = 2000;

export function readStdin({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}
