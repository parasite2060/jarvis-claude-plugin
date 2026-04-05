import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MANIFEST_FILENAME = '.manifest.json';

function readLocalManifest(cacheDir) {
  try {
    const raw = readFileSync(join(cacheDir, MANIFEST_FILENAME), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalManifest(cacheDir, files, manifestHash) {
  const manifest = {
    files: files.map(f => ({ path: f.path, hash: f.hash, updatedAt: f.updatedAt })),
    manifestHash,
    lastSync: new Date().toISOString(),
  };
  writeFileSync(join(cacheDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

export async function syncFiles(serverUrl, apiKey, cacheDir, extraHeaders = {}) {
  const headers = { Authorization: `Bearer ${apiKey}`, ...extraHeaders };
  try {
    const manifestRes = await fetch(`${serverUrl}/memory/files/manifest`, {
      headers,
    });

    if (!manifestRes.ok) {
      const msg = `manifest request failed: ${manifestRes.status}`;
      console.error(`jarvis.file-sync.manifest-fetch-failed: ${msg}`);
      return { synced: false, reason: 'error', error: msg };
    }

    const manifestBody = await manifestRes.json();
    const serverFiles = manifestBody.data?.files ?? [];
    const serverManifestHash = manifestBody.data?.manifestHash;

    const localManifest = readLocalManifest(cacheDir);

    if (localManifest && localManifest.manifestHash === serverManifestHash) {
      return { synced: false, reason: 'no-changes' };
    }

    const localFileMap = new Map();
    if (localManifest?.files) {
      for (const f of localManifest.files) {
        localFileMap.set(f.path, f);
      }
    }

    const serverFileMap = new Map();
    for (const f of serverFiles) {
      serverFileMap.set(f.path, f);
    }

    const toDownload = serverFiles.filter(f => {
      const local = localFileMap.get(f.path);
      return !local || local.hash !== f.hash;
    });

    const toDelete = [];
    for (const [p] of localFileMap) {
      if (!serverFileMap.has(p)) toDelete.push(p);
    }

    let filesDownloaded = 0;
    const failedPaths = new Set();
    for (const file of toDownload) {
      try {
        const fileRes = await fetch(`${serverUrl}/memory/files/${encodePath(file.path)}`, {
          headers,
        });
        if (!fileRes.ok) {
          console.error(`jarvis.file-sync.download-failed: ${file.path} status=${fileRes.status}`);
          failedPaths.add(file.path);
          continue;
        }
        const fileBody = await fileRes.json();
        const content = fileBody.data?.content ?? '';
        const filePath = join(cacheDir, file.path);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf8');
        filesDownloaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`jarvis.file-sync.download-error: ${file.path} ${msg}`);
        failedPaths.add(file.path);
      }
    }

    let filesDeleted = 0;
    for (const p of toDelete) {
      try {
        unlinkSync(join(cacheDir, p));
        filesDeleted++;
      } catch {
        // ignore — file may already be gone
      }
    }

    const hasFailures = failedPaths.size > 0;

    // Build manifest files list: use server hashes for successful downloads
    // and unchanged files, but keep old local hashes for failed downloads
    // so they will be retried on next poll. Files that were never local and
    // failed get a null hash so they're always detected as changed.
    const manifestFiles = serverFiles.map(f => {
      if (failedPaths.has(f.path)) {
        const local = localFileMap.get(f.path);
        return local || { path: f.path, hash: null, updatedAt: f.updatedAt };
      }
      return f;
    });

    // Don't update manifestHash when there are download failures —
    // this forces a full re-comparison on next poll.
    const savedManifestHash = hasFailures
      ? (localManifest?.manifestHash ?? null)
      : serverManifestHash;

    writeLocalManifest(cacheDir, manifestFiles, savedManifestHash);

    return {
      synced: true,
      filesDownloaded,
      filesDeleted,
      filesFailed: failedPaths.size,
      manifestHash: serverManifestHash,
      fileCount: serverFiles.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`jarvis.file-sync.error: ${msg}`);
    return { synced: false, reason: 'error', error: msg };
  }
}
