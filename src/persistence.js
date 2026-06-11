import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Loads a previously saved metrics snapshot from disk.
 * Returns `null` if the file does not exist yet.
 */
export async function loadSnapshot(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Atomically writes a metrics snapshot to disk (write to a temp file, then
 * rename), so a crash mid-write cannot corrupt the existing snapshot.
 */
export async function saveSnapshot(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state));
  await rename(tmpPath, filePath);
}
