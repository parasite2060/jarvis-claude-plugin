/**
 * Mock-server helper for SOUL/IDENTITY/MEMORY hook tests. Each hook fetches a
 * memory document from a known endpoint; this spins up a one-route server so
 * each test can assert the same contract with different fixtures.
 */

import { createServer } from 'node:http';

export async function startMemoryDocServer({ endpoint, content, filePath }) {
  const server = createServer((req, res) => {
    if (req.url === endpoint && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        data: { content, filePath },
      }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}
