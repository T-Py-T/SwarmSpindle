import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeWorkspacePath, type FileChange, type WorkspaceFile } from '@simpleswarm/swarm';

export const workspaceLimits = { entries: 4096, fileBytes: 16 * 1024 * 1024, totalBytes: 48 * 1024 * 1024, outputBytes: 256 * 1024 };
export interface SnapshotEntry { path: string; contentBase64: string }

export function decodeContent(content: string): Buffer {
  if (typeof content !== 'string' || content.length % 4 !== 0 || content.length > Math.ceil(workspaceLimits.fileBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
    throw new Error('Workspace file content must be canonical base64 within the file size limit.');
  }
  const bytes = Buffer.from(content, 'base64');
  if (bytes.length > workspaceLimits.fileBytes || bytes.toString('base64') !== content) throw new Error('Invalid or oversized workspace content.');
  return bytes;
}

export function validateEntries(entries: SnapshotEntry[]): void {
  if (entries.length > workspaceLimits.entries) throw new Error('Workspace contains too many files.');
  const paths = new Set<string>();
  const directories = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    const path = normalizeWorkspacePath(entry.path);
    if (paths.has(path)) throw new Error('Duplicate workspace path.');
    paths.add(path);
    totalBytes += decodeContent(entry.contentBase64).length;
    if (totalBytes > workspaceLimits.totalBytes) throw new Error('Workspace exceeds its total size limit.');
  }
  for (const path of paths) {
    const components = path.split('/');
    while (components.length > 1) {
      components.pop();
      if (paths.has(components.join('/'))) throw new Error('Workspace path is both a file and a directory.');
      directories.add(components.join('/'));
    }
  }
  if (paths.size + directories.size > workspaceLimits.entries) throw new Error('Workspace contains too many files and directories.');
}

export function validateSnapshot(files: WorkspaceFile[]): void {
  validateEntries(files);
  for (const file of files) {
    if (!Number.isSafeInteger(file.revision) || file.revision < 1 || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.deleted !== 'boolean') throw new Error('Invalid workspace file revision or metadata.');
    if (!file.deleted && decodeContent(file.contentBase64).length !== file.size) throw new Error('Workspace file size does not match its contents.');
    if (file.deleted && file.contentBase64 !== '') throw new Error('Deleted workspace files must have empty contents.');
  }
}

export async function materializeSnapshot(directory: string, files: WorkspaceFile[]): Promise<void> {
  for (const file of files) {
    if (file.deleted) continue;
    const target = join(directory, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o444);
    try { await handle.writeFile(decodeContent(file.contentBase64)); } finally { await handle.close(); }
  }
}

export function compareSnapshot(before: WorkspaceFile[], after: SnapshotEntry[]): FileChange[] {
  validateSnapshot(before);
  validateEntries(after);
  const originals = new Map(before.map(file => [file.path, file]));
  const currentPaths = new Set(after.map(file => file.path));
  const changes: FileChange[] = [];
  for (const file of after) {
    const original = originals.get(file.path);
    if (!original || original.deleted || original.contentBase64 !== file.contentBase64) changes.push({ path: file.path, baseRevision: original?.revision ?? 0, contentBase64: file.contentBase64 });
  }
  for (const file of before) {
    if (!file.deleted && !currentPaths.has(file.path)) changes.push({ path: file.path, baseRevision: file.revision, contentBase64: null });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}
