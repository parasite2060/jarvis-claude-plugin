import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('file-sync > syncFiles', () => {
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

  it('should download all files when no local manifest exists', async () => {
    // Arrange
    const serverFiles = [
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'IDENTITY.md', hash: 'bbb', size: 20, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'manifest-hash-1'))
      .mockResolvedValueOnce(makeFileResponse('# Soul', 'SOUL.md', 'aaa'))
      .mockResolvedValueOnce(makeFileResponse('# Identity', 'IDENTITY.md', 'bbb'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(2);
    expect(result.filesDeleted).toBe(0);
    expect(result.manifestHash).toBe('manifest-hash-1');
    expect(readFileSync(join(cacheDir, 'SOUL.md'), 'utf8')).toBe('# Soul');
    expect(readFileSync(join(cacheDir, 'IDENTITY.md'), 'utf8')).toBe('# Identity');
    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest.manifestHash).toBe('manifest-hash-1');
    expect(manifest.files).toHaveLength(2);
    expect(manifest.lastSync).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should download only changed files when manifest hash differs', async () => {
    // Arrange
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
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'MEMORY.md', hash: 'ccc', size: 30, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'new-hash'))
      .mockResolvedValueOnce(makeFileResponse('# Memory', 'MEMORY.md', 'ccc'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(1);
    expect(readFileSync(join(cacheDir, 'MEMORY.md'), 'utf8')).toBe('# Memory');
    expect(readFileSync(join(cacheDir, 'SOUL.md'), 'utf8')).toBe('# Old Soul');
  });

  it('should return synced:false with reason "no-changes" when manifest hashes match', async () => {
    // Arrange
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

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(false);
    expect(result.reason).toBe('no-changes');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should delete files that are no longer in the server manifest', async () => {
    // Arrange
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
    ];
    mockFetch.mockResolvedValueOnce(makeManifestResponse(serverFiles, 'new-hash'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(true);
    expect(result.filesDeleted).toBe(1);
    expect(existsSync(join(cacheDir, 'OLD.md'))).toBe(false);
    expect(existsSync(join(cacheDir, 'SOUL.md'))).toBe(true);
  });

  it('should write .manifest.json with correct structure when sync succeeds', async () => {
    // Arrange
    const serverFiles = [
      { path: 'SOUL.md', hash: 'aaa', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-1'))
      .mockResolvedValueOnce(makeFileResponse('# Soul', 'SOUL.md', 'aaa'));

    // Act
    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      manifestHash: 'hash-1',
      files: [{ path: 'SOUL.md', hash: 'aaa', updatedAt: '2026-03-30T10:00:00Z' }],
    });
    expect(manifest.lastSync).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should retain old .manifest.json when server is unreachable (graceful degradation)', async () => {
    // Arrange
    const localManifest = {
      files: [{ path: 'SOUL.md', hash: 'aaa', updatedAt: '2026-03-30T09:00:00Z' }],
      manifestHash: 'old-hash',
      lastSync: '2026-03-30T09:00:00Z',
    };
    writeFileSync(join(cacheDir, '.manifest.json'), JSON.stringify(localManifest), 'utf8');
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(false);
    expect(result.reason).toBe('error');
    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest.manifestHash).toBe('old-hash');
  });

  it('should create subdirectories when nested files are downloaded', async () => {
    // Arrange
    const serverFiles = [
      { path: 'decisions/_index.md', hash: 'eee', size: 50, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-nested'))
      .mockResolvedValueOnce(makeFileResponse('# Decisions Index', 'decisions/_index.md', 'eee'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(1);
    expect(readFileSync(join(cacheDir, 'decisions', '_index.md'), 'utf8')).toBe('# Decisions Index');
  });

  it('should return error result without throwing when server is unreachable', async () => {
    // Arrange
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('should return error result when manifest response is non-ok', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('should continue downloading remaining files when one file download fails', async () => {
    // Arrange
    const serverFiles = [
      { path: 'A.md', hash: 'a1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'B.md', hash: 'b1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-partial'))
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(makeFileResponse('# B', 'B.md', 'b1'));

    // Act
    const result = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result.synced).toBe(true);
    expect(result.filesDownloaded).toBe(1);
    expect(result.filesFailed).toBe(1);
    expect(existsSync(join(cacheDir, 'B.md'))).toBe(true);
  });

  it('should keep manifestHash null when downloads fail (enables retry on next poll)', async () => {
    // Arrange
    const serverFiles = [
      { path: 'A.md', hash: 'a1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
      { path: 'B.md', hash: 'b1', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-partial'))
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(makeFileResponse('# B', 'B.md', 'b1'));

    // Act
    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest.manifestHash).toBeNull();

    // Arrange (next poll)
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-partial'))
      .mockResolvedValueOnce(makeFileResponse('# A', 'A.md', 'a1'));

    // Act
    const result2 = await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    expect(result2.synced).toBe(true);
    expect(result2.filesDownloaded).toBe(1);
    expect(existsSync(join(cacheDir, 'A.md'))).toBe(true);
    expect(readFileSync(join(cacheDir, 'A.md'), 'utf8')).toBe('# A');
    const manifest2 = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest2.manifestHash).toBe('hash-partial');
  });

  it('should keep old local hash for failed files so they retry on next poll', async () => {
    // Arrange
    const localManifest = {
      files: [{ path: 'A.md', hash: 'old-a', updatedAt: '2026-03-30T09:00:00Z' }],
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
      .mockResolvedValueOnce({ ok: false, status: 500 });

    // Act
    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    const manifest = JSON.parse(readFileSync(join(cacheDir, '.manifest.json'), 'utf8'));
    expect(manifest.manifestHash).toBe('old-hash');
    const fileA = manifest.files.find(f => f.path === 'A.md');
    expect(fileA.hash).toBe('old-a');
    expect(readFileSync(join(cacheDir, 'A.md'), 'utf8')).toBe('# Old A');
  });

  it('should URI-encode file paths when fetching files with special characters', async () => {
    // Arrange
    const serverFiles = [
      { path: 'my notes/file #1.md', hash: 'fff', size: 10, updatedAt: '2026-03-30T10:00:00Z' },
    ];
    mockFetch
      .mockResolvedValueOnce(makeManifestResponse(serverFiles, 'hash-encoded'))
      .mockResolvedValueOnce(makeFileResponse('# Notes', 'my notes/file #1.md', 'fff'));

    // Act
    await syncFiles(SERVER_URL, API_KEY, cacheDir);

    // Assert
    const downloadCall = mockFetch.mock.calls[1];
    expect(downloadCall[0]).toBe(`${SERVER_URL}/memory/files/my%20notes/file%20%231.md`);
  });
});
