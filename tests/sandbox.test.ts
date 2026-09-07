import { describe, expect, test } from 'bun:test';
import { compareSnapshot, createPodmanSandbox, validateSnapshot } from '@simpleswarm/sandbox';
import type { WorkspaceFile } from '@simpleswarm/swarm';

function file(path: string, content: string, revision = 1): WorkspaceFile {
  return { path, revision, authorId: 'agent', createdAt: 1, reason: 'test fixture', deleted: false, size: Buffer.byteLength(content), contentBase64: Buffer.from(content).toString('base64') };
}

describe('sandbox snapshot boundary', () => {
  test('produces atomic revision-aware additions, replacements and deletions', () => {
    const original = [file('keep.txt', 'same', 3), file('replace.txt', 'old', 8), file('delete.txt', 'gone', 4)];
    expect(compareSnapshot(original, [file('keep.txt', 'same'), file('replace.txt', 'new'), file('new.txt', 'new')])).toEqual([
      { path: 'delete.txt', baseRevision: 4, contentBase64: null },
      { path: 'new.txt', baseRevision: 0, contentBase64: 'bmV3' },
      { path: 'replace.txt', baseRevision: 8, contentBase64: 'bmV3' },
    ]);
    expect(original[1]?.contentBase64).toBe('b2xk');
  });

  test('preserves binary files and tombstone revisions', () => {
    const deleted = { ...file('image.png', '', 9), deleted: true };
    const binary = Buffer.from([0, 255, 254, 1, 0]);
    expect(compareSnapshot([deleted], [{ path: 'image.png', contentBase64: binary.toString('base64') }])).toEqual([
      { path: 'image.png', baseRevision: 9, contentBase64: 'AP/+AQA=' },
    ]);
    expect(compareSnapshot([deleted], [])).toEqual([]);
  });

  test.each(['../escape', '/etc/passwd', 'a/../b', 'a//b', 'a\\b', '.git/config', '.swarm/state', 'a\0b', 'a/./b'])('rejects unsafe path %s', path => {
    expect(() => validateSnapshot([file(path, '')])).toThrow();
    expect(() => compareSnapshot([], [{ path, contentBase64: '' }])).toThrow();
  });

  test.each(['A', 'AA', 'AA=', '====', 'AB==', ' AA==', 'AA==\n', 'YWJj-_=='])('rejects noncanonical base64 %s', contentBase64 => {
    expect(() => validateSnapshot([{ ...file('a', ''), contentBase64 }])).toThrow();
  });

  test('rejects conflicting paths, lying metadata, invalid revisions and oversize content', () => {
    expect(() => validateSnapshot([file('a', ''), file('a', '')])).toThrow();
    expect(() => validateSnapshot([file('a', ''), file('a/b', '')])).toThrow();
    expect(() => validateSnapshot([{ ...file('a', 'x'), size: 0 }])).toThrow();
    expect(() => validateSnapshot([file('a', '', 0)])).toThrow();
    expect(() => validateSnapshot([{ ...file('a', 'x'), deleted: true }])).toThrow();
    expect(() => validateSnapshot([file('large', 'x'.repeat(16 * 1024 * 1024 + 1))])).toThrow();
    expect(() => validateSnapshot(Array.from({ length: 4097 }, (_, index) => file(`file-${index}`, '')))).toThrow();
  });

  test('rejects unsafe options and requests before invoking the engine', async () => {
    expect(() => createPodmanSandbox({ maxConcurrent: 5 })).toThrow();
    expect(() => createPodmanSandbox({ maxConcurrent: 0 })).toThrow();
    expect(() => createPodmanSandbox({ image: '--privileged' })).toThrow();
    expect(() => createPodmanSandbox({ runtimeDirectory: 'relative' })).toThrow();
    const sandbox = createPodmanSandbox();
    const request = { swarmId: 'run', agentId: 'agent', command: 'echo hi', files: [], timeoutSeconds: 1, signal: new AbortController().signal };
    await expect(sandbox.execute({ ...request, command: '' })).rejects.toThrow();
    await expect(sandbox.execute({ ...request, timeoutSeconds: 601 })).rejects.toThrow();
    await expect(sandbox.execute({ ...request, files: [file('../escape', '')] })).rejects.toThrow();
    await expect(sandbox.execute({ ...request, signal: AbortSignal.abort(new Error('cancelled')) })).rejects.toThrow('cancelled');
    await sandbox.stop('never-started');
    await expect(sandbox.execute({ ...request, swarmId: 'never-started' })).rejects.toThrow('stopped');
  });
});
