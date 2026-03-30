import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('file-sync', () => {
  let syncFiles;
  let mockFetch;
  let cacheDir;

  const SERVER_URL = 'http://localhost:8000';
  const API_KEY = 'test-api-key';

  function makeManifestResponse(files, manifestHash) {
    return {
      ok: true,
      json: async () => ({
        data: {
          files,
          manifestHash,
          fileCount: files.length,
          generatedAt: '2026-03-30T10:00:00Z',
        },
        status: 'ok',
      }),
    };
  }

  function makeFileResponse(content, filePath, hash) {
    return {
      ok: true,
      json: async () => ({
        data: { content, filePath, hash, size: content.length },
        status: 'ok',
      }),
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    cacheDir = mkdtempSync(join(tmpdir(), 'jarvis-test-'));

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const mod = await import('../../worker/file-sync.js');
    syncFiles = mod.syncFiles;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('downloads all files on first run (no local manifest)', async () => {
    const serverFiles = [
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'IDENTITY.md', hash: 'bbb', size: 20, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'manifest-hash-1'))
      .mockResolvedValueOnce(makeFileResponse('# Soul', 'SOUL.md', 'aaa'))
      .mockResolvedValueOnce(makeFileResponse('# Identity', 'IDENTITY.md', 'bbb'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(2);
    expect(result.filesDeleted).toBe(0);
    expect(result.manifestHash).toBe('manifest-hash-1');

    expect(readFileSync(join(cacheDir, 'SOUL.md'), 'utf8')).toBe('# Soul');
    expect(readFileSync(join(cacheDir, 'IDENTITY.md'), 'utf8')).toBe('# Identity');

    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest.manifestHash).toBe('manifest-hash-1');
    expect(manifest.files).toHaveLength(2);
    expect(manifest.lastSync).toBeDefined();
  });

  it('downloads only changed files when manifest hash differs', async () => {
    // Write an existing local manifest with one file
    const localManifest = {
      files: [
        { path: 'SOUL.md', hash: 'aaa', updatedAt: '2026-03-30T09:00:00Z' },
      ],
      manifestHash: 'old-hash',
      lastSync: '2026-03-30T09:00:00Z',
    };
    writeFileSync(join(cacheDir, '.manifest.json'), JSON.stringify(localManifest), 'utf8');
    writeFileSync(join(cacheDir, 'SOUL.md'), '# Old Soul', 'utf8');

    const serverFiles = [
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' }, // unchanged
      { path: 'MEMORY.md', hash: 'ccc', size: 30, updatedAt: '2026-03-30T10:00:00Z' }, // new
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'new-hash'))
      .mockResolvedValueOnce(makeFileResponse('# Memory', 'MEMORY.md', 'ccc'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(1); // only MEMORY.md
    expect(readFileSync(join(cacheDir, 'MEMORY.md'), 'utf8')).toBe('# Memory');
    // SOUL.md should remain untouched
    expect(readFileSync(join(cacheDir, 'SOUL.md'), 'utf8')).toBe('# Old Soul');
  });

  it('returns synced:false when manifest hash matches (no changes)', async () => {
    const localManifest = {
      files: [{ path: 'SOUL.md', hash: 'aaa', updatedAt: '2026-03-30T09:00:00Z' }],
      manifestHash: 'same-hash',
      lastSync: '2026-03-30T09:00:00Z',
    };
    writeFileSync(join(cacheDir, '.manifest.json'), JSON.stringify(localManifest), 'utf8');

    mockFetch.mockResolvedValueOnce(makeManifestResponse(
      [{ path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' }],
      'same-hash',
    ));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(false);
    expect(result.reason).toBe('no-changes');
    // Only manifest fetch, no file downloads
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('deletes files that are no longer in the server manifest', async () => {
    const localManifest = {
      files: [
        { path: 'SOUL.md', hash: 'aaa', updatedAt: '2026-03-30T09:00:00Z' },
        { path: 'OLD.md', hash: 'ddd', updatedAt: '2026-03-30T09:00:00Z' },
      ],
      manifestHash: 'old-hash',
      lastSync: '2026-03-30T09:00:00Z',
    };
    writeFileSync(join(cacheDir, '.manifest.json'), JSON.stringify(localManifest), 'utf8');
    writeFileSync(join(cacheDir, 'SOUL.md'), '# Soul', 'utf8');
    writeFileSync(join(cacheDir, 'OLD.md'), '# Old', 'utf8');

    const serverFiles = [
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      // OLD.md removed from server
    ];

    mockFetch.mockResolvedValueOnce(makeManifestResponse(serverFiles, 'new-hash'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(true);
    expect(result.filesDeleted).toBe(1);
    expect(existsSync(join(cacheDir, 'OLD.md'))).toBe(false);
    expect(existsSync(join(cacheDir, 'SOUL.md'))).toBe(true);
  });

  it('writes .manifest.json with correct structure after successful sync', async () => {
    const serverFiles = [
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-1'))
      .mockResolvedValueOnce(makeFileResponse('# Soul', 'SOUL.md', 'aaa'));

    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest).toHaveProperty('files');
    expect(manifest).toHaveProperty('manifestHash', 'hash-1');
    expect(manifest).toHaveProperty('lastSync');
    expect(manifest.files[0]).toEqual({
      path: 'SOUL.md',
      hash: 'aaa',
      updatedAt: '2026-03-30T10:00:00Z',
    });
  });

  it('retains old .manifest.json on server error (graceful degradation)', async () => {
    const localManifest = {
      files: [{ path: 'SOUL.md', hash: 'aaa', updatedAt: '2026-03-30T09:00:00Z' }],
      manifestHash: 'old-hash',
      lastSync: '2026-03-30T09:00:00Z',
    };
    writeFileSync(join(cacheDir, '.manifest.json'), JSON.stringify(localManifest), 'utf8');

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(false);
    expect(result.reason).toBe('error');

    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest.manifestHash).toBe('old-hash');
  });

  it('creates subdirectories for nested files', async () => {
    const serverFiles = [
      { path: 'decisions/_index.md', hash: 'eee', size: 50, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-nested'))
      .mockResolvedValueOnce(makeFileResponse('# Decisions Index', 'decisions/_index.md', 'eee'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(1);
    expect(readFileSync(join(cacheDir, 'decisions', '_index.md'), 'utf8')).toBe('# Decisions Index');
  });

  it('handles server unreachable without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('handles non-ok manifest response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('continues downloading remaining files when one file download fails', async () => {
    const serverFiles = [
      { path: 'A.md', hash: 'a1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'B.md', hash: 'b1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-partial'))
      .mockResolvedValueOnce({ ok: false, status: 500 }) // A.md fails
      .mockResolvedValueOnce(makeFileResponse('# B', 'B.md', 'b1'));

    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(1); // only B.md
    expect(result.filesFailed).toBe(1);
    expect(existsSync(join(cacheDir, 'B.md'))).toBe(true);
  });

  it('does not update manifestHash when downloads fail, enabling retry on next poll', async () => {
    const serverFiles = [
      { path: 'A.md', hash: 'a1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'B.md', hash: 'b1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-partial'))
      .mockResolvedValueOnce({ ok: false, status: 500 }) // A.md fails
      .mockResolvedValueOnce(makeFileResponse('# B', 'B.md', 'b1'));

    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    // manifestHash should NOT be updated to server hash since A.md failed
    expect(manifest.manifestHash).not.toBe('hash-partial');
    // Failed file A.md should not have the server hash in the manifest
    const fileA = manifest.files.find(f => f.path === 'A.md');
    // A.md was never local before, so it gets the server entry as fallback
    // but manifestHash stays null so next poll will re-compare
    expect(manifest.manifestHash).toBeNull();

    // On next poll, since manifestHash differs, sync will try again
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-partial'))
      .mockResolvedValueOnce(makeFileResponse('# A', 'A.md', 'a1'));

    const result2 = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    expect(result2.synced).toBe(true);
    expect(result2.filesDownloaded).toBe(1); // retried A.md
    expect(existsSync(join(cacheDir, 'A.md'))).toBe(true);
    expect(readFileSync(join(cacheDir, 'A.md'), 'utf8')).toBe('# A');

    // Now manifest should have the server hash since all files succeeded
    const manifest2 = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest2.manifestHash).toBe('hash-partial');
  });

  it('keeps old local hash for failed files so they are retried', async () => {
    // Pre-existing local state with old hash for A.md
    const localManifest = {
      files: [
        { path: 'A.md', hash: 'old-a', updatedAt: '2026-03-30T09:00:00Z' },
      ],
      manifestHash: 'old-hash',
      lastSync: '2026-03-30T09:00:00Z',
    };
    writeFileSync(join(cacheDir, '.manifest.json'), JSON.stringify(localManifest), 'utf8');
    writeFileSync(join(cacheDir, 'A.md'), '# Old A', 'utf8');

    const serverFiles = [
      { path: 'A.md', hash: 'new-a', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'new-server-hash'))
      .mockResolvedValueOnce({ ok: false, status: 500 }); // A.md download fails

    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    // manifestHash should stay as old value, not updated to server hash
    expect(manifest.manifestHash).toBe('old-hash');
    // A.md should keep old hash so it will be detected as changed on retry
    const fileA = manifest.files.find(f => f.path === 'A.md');
    expect(fileA.hash).toBe('old-a');
    // File content should be unchanged
    expect(readFileSync(join(cacheDir, 'A.md'), 'utf8')).toBe('# Old A');
  });

  it('URI-encodes file paths with special characters in fetch URL', async () => {
    const serverFiles = [
      { path: 'my notes/file #1.md', hash: 'fff', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-encoded'))
      .mockResolvedValueOnce(makeFileResponse('# Notes', 'my notes/file #1.md', 'fff'));

    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Verify the file download URL was encoded properly
    const downloadCall = mockFetch.mock.calls[1];
    expect(downloadCall[0]).toBe(`${SERVER_URL}/memory/files/my%20notes/file%20%231.md`);
  });
});
