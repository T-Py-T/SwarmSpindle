import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSwarmStore, parseSwarmSpec, SwarmError, type ArtifactAssessment, type SwarmStore } from '../modules/swarm/index.ts';

const directories: string[] = [];
const stores: SwarmStore[] = [];
const databases: Database[] = [];
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Pelícán review</text></svg>';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const encode = (value: string) => Buffer.from(value).toString('base64');

function fixture(content: string | null = svg, status: 'bailed' | 'completed' | null = 'bailed') {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-assessment-')); directories.push(directory);
  const path = join(directory, 'swarm.sqlite');
  let now = 1000;
  const store = openSwarmStore(path, { clock: () => now }); stores.push(store);
  const run = store.createSwarm(parseSwarmSpec({
    task: 'Produce a reviewed pelican illustration.', definitionOfDone: 'Render the SVG and review contact points.',
    finalOutput: 'pelican.svg', agentCount: 2, budgetMicros: 1000,
    model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
  }), content === null ? [] : [{ path: 'pelican.svg', baseRevision: 0, contentBase64: encode(content) }]);
  store.registerWorker('assessment-fixture-worker', 123);
  store.claimNextSwarm('assessment-fixture-worker');
  for (const agent of run.agents) store.startAgent({ swarmId: run.id, agentId: agent.id }, `synthetic-${agent.id}`);
  const first = run.agents[0];
  if (!first) throw new Error('Expected a fixture agent.');
  const actor = { swarmId: run.id, agentId: first.id };
  const settled = store.reserve(actor, 200, 'Synthetic known usage; no provider call');
  store.settle(settled.id, 80, { input: 2, output: 3, cacheRead: 4, cacheWrite: 0 });
  const unresolved = store.reserve(actor, 40, 'Synthetic unresolved usage; no provider call');
  store.markUncertain(unresolved.id, 'Fixture preserves uncertain liability during operator assessment.');
  now = 1100;
  if (status === 'completed') for (const agent of run.agents) store.endAgent({ swarmId: run.id, agentId: agent.id }, 'done', 'Synthetic agent completion claim');
  if (status !== null) store.finishSwarm(run.id, status, 'Historical terminal outcome must remain unchanged.');
  const database = new Database(path); databases.push(database);
  return { store, path, run, database, tick: () => { now += 100; } };
}

function inputFor(f: ReturnType<typeof fixture>): Omit<ArtifactAssessment, 'createdAt' | 'verdict'> {
  const current = f.store.getSwarm(f.run.id);
  const file = f.store.files(f.run.id).find(file => file.path === current.spec.finalOutput);
  return {
    path: current.spec.finalOutput, revision: file?.revision ?? 0,
    sha256: file ? sha256(Buffer.from(file.contentBase64, 'base64')) : null,
    definitionOfDoneSha256: sha256(current.spec.definitionOfDone),
    checks: [
      { name: 'Artifact available', passed: Boolean(file), evidence: file ? 'Read the exact canonical bytes.' : 'The expected canonical file is missing.' },
      { name: 'Contact review', passed: false, evidence: 'Operator inspected the rendering; wing contact still needs correction.' },
    ],
  };
}

function rawRun(f: ReturnType<typeof fixture>): string {
  const row = f.database.query<{ body: string }, [string]>('SELECT body FROM swarms WHERE id = ?').get(f.run.id);
  if (!row) throw new Error('Missing raw fixture run.');
  return row.body;
}

function rejects(action: () => unknown, code: string): void {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(SwarmError);
    if (!(error instanceof SwarmError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('operator artifact assessments', () => {
  test('adds the table to an old database and preserves historical run bytes, events and ledger across a real reopen', () => {
    const f = fixture();
    const before = rawRun(f);
    const events = f.store.events(f.run.id);
    const reservations = f.store.reservations(f.run.id);
    const workers = f.store.listWorkers();
    const reservationOwners = f.database.query('SELECT * FROM reservation_owners ORDER BY id').all();
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    f.database.exec('DROP TABLE artifact_assessments');
    const upgraded = openSwarmStore(f.path, { clock: () => 1500 }); stores.push(upgraded);
    expect(upgraded.getSwarm(f.run.id).artifactAssessment).toBeUndefined();
    const input = inputFor({ ...f, store: upgraded });
    const assessment = upgraded.recordArtifactAssessment(f.run.id, input);
    expect(assessment).toEqual({ ...input, createdAt: 1500, verdict: 'failed' });
    expect(rawRun(f)).toBe(before);
    expect(upgraded.events(f.run.id)).toEqual(events);
    expect(upgraded.reservations(f.run.id)).toEqual(reservations);
    expect(upgraded.listWorkers()).toEqual(workers);
    expect(f.database.query('SELECT * FROM reservation_owners ORDER BY id').all()).toEqual(reservationOwners);
    upgraded.close(); stores.splice(stores.indexOf(upgraded), 1);
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    expect(reopened.getSwarm(f.run.id).artifactAssessment).toEqual(assessment);
    expect(reopened.listSwarms().find(run => run.id === f.run.id)?.artifactAssessment).toEqual(assessment);
    expect(rawRun(f)).toBe(before);
    expect(reopened.getSwarm(f.run.id)).toMatchObject({ status: 'bailed', budget: { settledMicros: 80, uncertainMicros: 40 } });
  });

  test('derives a passing review from every check without converting a stopped run into runtime success', () => {
    const f = fixture(); const before = rawRun(f); const input = inputFor(f);
    input.checks = [{ name: 'Operator review', passed: true, evidence: 'Reviewed this exact revision against the stated criteria.' }];
    f.tick();
    expect(f.store.recordArtifactAssessment(f.run.id, input)).toMatchObject({ verdict: 'passed', createdAt: 1200 });
    expect(f.store.getSwarm(f.run.id).status).toBe('bailed');
    expect(rawRun(f)).toBe(before);
    const other = f.store.createSwarm(f.run.spec);
    expect(f.store.getSwarm(other.id).artifactAssessment).toBeUndefined();
  });

  test('a failed assessment leaves an existing agent completion claim unchanged', () => {
    const f = fixture(svg, 'completed'); const before = rawRun(f);
    expect(f.store.recordArtifactAssessment(f.run.id, inputFor(f)).verdict).toBe('failed');
    expect(f.store.getSwarm(f.run.id).status).toBe('completed');
    expect(rawRun(f)).toBe(before);
  });

  test('permits review of exhausted, failed, cancelled and interrupted runs without rewriting their outcomes', () => {
    const statuses = ['budget_exhausted', 'failed', 'cancelled', 'interrupted'] as const;
    for (const status of statuses) {
      const f = fixture(svg, null);
      f.store.finishSwarm(f.run.id, status, 'Preserve this original runtime result.');
      const before = rawRun(f);
      expect(f.store.recordArtifactAssessment(f.run.id, inputFor(f)).verdict).toBe('failed');
      expect(f.store.getSwarm(f.run.id).status).toBe(status);
      expect(rawRun(f)).toBe(before);
    }
  });

  test('rejects queued, running and stopping runs before assessment persistence', () => {
    const f = fixture(svg, null); const input = inputFor(f);
    rejects(() => f.store.recordArtifactAssessment(f.run.id, input), 'run_not_terminal');
    f.store.stopSwarm(f.run.id, 'Stopping fixture');
    rejects(() => f.store.recordArtifactAssessment(f.run.id, input), 'run_not_terminal');
    const queued = f.store.createSwarm(f.run.spec);
    rejects(() => f.store.recordArtifactAssessment(queued.id, input), 'run_not_terminal');
    expect(f.database.query('SELECT * FROM artifact_assessments').all()).toEqual([]);
  });

  test('rejects stale path, revision, content digest and definition digest without overwriting the last assessment', () => {
    const f = fixture(); const input = inputFor(f); const saved = f.store.recordArtifactAssessment(f.run.id, input);
    const stale = [
      { ...input, path: 'other.svg' }, { ...input, revision: 2 },
      { ...input, sha256: sha256('different bytes') },
      { ...input, definitionOfDoneSha256: sha256('different criteria') },
    ];
    for (const value of stale) {
      rejects(() => f.store.recordArtifactAssessment(f.run.id, value), 'assessment_stale');
      expect(f.store.getSwarm(f.run.id).artifactAssessment).toEqual(saved);
    }
  });

  test('binds a missing output to revision zero and a null hash but never records it as passed', () => {
    const f = fixture(null); const input = inputFor(f); const before = rawRun(f);
    const failed = f.store.recordArtifactAssessment(f.run.id, input);
    expect(failed).toMatchObject({ path: 'pelican.svg', revision: 0, sha256: null, verdict: 'failed' });
    rejects(() => f.store.recordArtifactAssessment(f.run.id, { ...input, checks: [{ name: 'Invented result', passed: true, evidence: 'A file was claimed to exist.' }] }), 'assessment_missing_output');
    expect(f.store.getSwarm(f.run.id).artifactAssessment).toEqual(failed);
    expect(rawRun(f)).toBe(before);
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    expect(reopened.getSwarm(f.run.id).artifactAssessment).toEqual(failed);
  });

  test('rejects forged verdicts, timestamps, empty checks and malformed or unbounded evidence', () => {
    const f = fixture(); const input = inputFor(f); const before = rawRun(f);
    const invalid: unknown[] = [
      null, [], { ...input, verdict: 'passed' }, { ...input, createdAt: 0 },
      { ...input, checks: [] }, { ...input, revision: -1 }, { ...input, revision: 0.5 },
      { ...input, revision: 0 }, { ...input, sha256: null }, { ...input, sha256: 'not-a-hash' },
      { ...input, path: '../pelican.svg' },
      { ...input, checks: [{ name: ' ', passed: true, evidence: 'Evidence' }] },
      { ...input, checks: [{ name: 'Review', passed: true, evidence: ' ' }] },
      { ...input, checks: [{ name: 'Review', passed: 'true', evidence: 'Evidence' }] },
      { ...input, checks: [{ name: 'Review', passed: true, evidence: 'x'.repeat(10001) }] },
      { ...input, checks: [{ name: 'x'.repeat(121), passed: true, evidence: 'Evidence' }] },
      { ...input, checks: [{ name: 'Review', passed: true, evidence: 'Evidence', verdict: 'passed' }] },
      { ...input, checks: Array.from({ length: 65 }, (_, index) => ({ name: `Check ${index}`, passed: true, evidence: 'Evidence' })) },
      { ...input, checks: [{ name: ' Review ', passed: true, evidence: 'Evidence' }, { name: 'review', passed: false, evidence: 'Contradiction' }] },
      { ...input, checks: Array.from({ length: 64 }, (_, index) => ({ name: `Check ${index}`, passed: true, evidence: '\u0000'.repeat(10000) })) },
    ];
    for (const value of invalid) rejects(() => f.store.recordArtifactAssessment(f.run.id, value), 'invalid_assessment');
    expect(f.database.query('SELECT * FROM artifact_assessments').all()).toEqual([]);
    expect(rawRun(f)).toBe(before);
  });

  test('stores a parsed copy and does not allow returned objects to alter persisted evidence', () => {
    const f = fixture(); const input = inputFor(f); const before = structuredClone(input);
    Object.freeze(input.checks[0]); Object.freeze(input.checks[1]); Object.freeze(input.checks); Object.freeze(input);
    const returned = f.store.recordArtifactAssessment(f.run.id, input);
    returned.verdict = 'passed'; returned.checks.splice(0);
    expect(input).toEqual(before);
    expect(f.store.getSwarm(f.run.id).artifactAssessment).toMatchObject({ verdict: 'failed', checks: before.checks });
  });

  test('hides a review after the definition of done changes and rejects an old reader across connections', () => {
    const f = fixture(); const old = inputFor(f); f.store.recordArtifactAssessment(f.run.id, old);
    const second = openSwarmStore(f.path); stores.push(second);
    f.database.query("UPDATE swarms SET body = json_set(body, '$.spec.definitionOfDone', ?) WHERE id = ?").run('Different complete criteria.', f.run.id);
    expect(second.getSwarm(f.run.id).artifactAssessment).toBeUndefined();
    expect(second.listSwarms().find(run => run.id === f.run.id)?.artifactAssessment).toBeUndefined();
    rejects(() => second.recordArtifactAssessment(f.run.id, old), 'assessment_stale');
    const fresh = inputFor(f);
    expect(second.recordArtifactAssessment(f.run.id, fresh).definitionOfDoneSha256).toBe(sha256('Different complete criteria.'));
  });

  test('hides a review after a new revision even when the artifact bytes are identical', () => {
    const f = fixture(); const old = inputFor(f); f.store.recordArtifactAssessment(f.run.id, old);
    const original = f.store.readFile(f.run.id, 'pelican.svg');
    f.database.query("UPDATE swarms SET body = json_insert(body, '$.versions[#]', json(?)) WHERE id = ?")
      .run(JSON.stringify({ ...original, revision: 2, createdAt: 1300, reason: 'Simulated future operator revision' }), f.run.id);
    expect(f.store.getSwarm(f.run.id).artifactAssessment).toBeUndefined();
    rejects(() => f.store.recordArtifactAssessment(f.run.id, old), 'assessment_stale');
  });

  test('hides a review when bytes change at the same revision and when the expected path changes', () => {
    const f = fixture(); f.store.recordArtifactAssessment(f.run.id, inputFor(f));
    const replacement = '<svg>Changed bytes</svg>';
    f.database.query("UPDATE swarms SET body = json_set(body, '$.versions[0].contentBase64', ?, '$.versions[0].size', ?) WHERE id = ?")
      .run(encode(replacement), Buffer.byteLength(replacement), f.run.id);
    expect(f.store.getSwarm(f.run.id).artifactAssessment).toBeUndefined();
    f.store.recordArtifactAssessment(f.run.id, inputFor(f));
    f.database.query("UPDATE swarms SET body = json_set(body, '$.spec.finalOutput', ?) WHERE id = ?").run('new-final.svg', f.run.id);
    expect(f.store.getSwarm(f.run.id).artifactAssessment).toBeUndefined();
  });

  test('a previously missing output appearing invalidates its recorded failure', () => {
    const f = fixture(null); f.store.recordArtifactAssessment(f.run.id, inputFor(f));
    const file = { path: 'pelican.svg', revision: 1, authorId: 'operator', createdAt: 1300,
      reason: 'Simulated future operator publication', deleted: false, size: Buffer.byteLength(svg), contentBase64: encode(svg) };
    f.database.query("UPDATE swarms SET body = json_insert(body, '$.versions[#]', json(?)) WHERE id = ?").run(JSON.stringify(file), f.run.id);
    expect(f.store.getSwarm(f.run.id).artifactAssessment).toBeUndefined();
  });

  test('a deleted latest revision is assessed as missing rather than using an older file', () => {
    const f = fixture(); const original = f.store.readFile(f.run.id, 'pelican.svg');
    f.database.query("UPDATE swarms SET body = json_insert(body, '$.versions[#]', json(?)) WHERE id = ?")
      .run(JSON.stringify({ ...original, revision: 2, deleted: true, contentBase64: '', size: 0 }), f.run.id);
    expect(f.store.recordArtifactAssessment(f.run.id, inputFor(f))).toMatchObject({ revision: 0, sha256: null, verdict: 'failed' });
  });

  test('fails closed on malformed stored evidence, including a forged derived verdict, after reopening', () => {
    const f = fixture(); const assessment = f.store.recordArtifactAssessment(f.run.id, inputFor(f)); const before = rawRun(f);
    const malformed = ['{', JSON.stringify({ ...assessment, verdict: 'passed' }), JSON.stringify({ ...assessment, checks: [] }),
      JSON.stringify({ ...assessment, createdAt: -1 }), JSON.stringify({ ...assessment, checks: [{ name: 'Review', passed: true, evidence: 'Proof' }], revision: 0, sha256: null, verdict: 'passed' })];
    for (const body of malformed) {
      f.database.query('UPDATE artifact_assessments SET body = ? WHERE swarm_id = ?').run(body, f.run.id);
      const reopened = openSwarmStore(f.path); stores.push(reopened);
      rejects(() => reopened.getSwarm(f.run.id), 'corrupt_assessment');
      rejects(() => reopened.listSwarms(), 'corrupt_assessment');
      expect(rawRun(f)).toBe(before);
    }
  });
});
