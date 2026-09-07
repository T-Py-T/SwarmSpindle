import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeWorkspacePath, type FileChange } from '@simpleswarm/swarm';

/** Read operator-selected references before making a run visible to workers. */
export async function readSeedDirectory(directory: string): Promise<FileChange[]> {
  const root = await realpath(directory);
  const files: FileChange[] = [];
  let totalBytes = 0;
  let entries = 0;
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (++entries > 4096) throw new Error('Reference directory exceeds 4096 entries.');
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      normalizeWorkspacePath(path);
      const hostPath = join(root,path);
      const metadata = await lstat(hostPath);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) throw new Error('Reference imports require ordinary files and directories; links are not accepted.');
      if (metadata.isDirectory()) { await visit(path); continue; }
      if (metadata.size > 10*1024*1024) throw new Error(`Reference file exceeds 10 MiB: ${path}`);
      totalBytes += metadata.size;
      if (totalBytes > 48*1024*1024) throw new Error('Reference import exceeds the 48 MiB command workspace allowance.');
      const content = await readFile(hostPath);
      if (content.length !== metadata.size) throw new Error(`Reference changed during import: ${path}`);
      files.push({path,baseRevision:0,contentBase64:content.toString('base64')});
    }
  }
  await visit('');
  return files;
}
