/**
 * Shared helper for hook integration tests. Spawns a hook script as a child
 * process, pipes stdin/stdout/stderr, and resolves with captured output.
 */

import { spawn } from 'node:child_process';

export function runHook(hookPath, stdinData, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [hookPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
    child.on('error', reject);

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}
