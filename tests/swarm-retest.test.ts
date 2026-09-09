import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSwarmStore } from '@simpleswarm/swarm';
import { canvasSeeds, challengeKinds, challengeSpec, claimChallengeBatch, claimRetestBatch, retestKinds, retestSpec } from '../tooling/swarm-retest.ts';

describe('bounded Claude retest batch', () => {
  test('larger artifact challenges retain two Claude peers, a $50 hard cap, and room to publish full artifacts', async () => {
    const specs = await Promise.all(challengeKinds.map(challengeSpec));
    expect(specs.map(spec => spec.finalOutput)).toEqual(['pelican.svg', 'shared/hero.html']);
    for (const spec of specs) expect(spec).toMatchObject({ agentCount: 2, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
      budgetMicros: 50_000_000, workingTargetMicros: 40_000_000, maxOutputTokens: 16_000, maxTurnsPerAgent: 60, maxRunMs: 1_200_000 });
  });
  test('the expanded allocation records its prerequisite and cannot be replayed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swarm-challenge-'));
    try {
      const claim = join(root, 'claim.json');
      const outcomes = await Promise.allSettled([claimChallengeBatch(claim, 'first', 'verified-probe'), claimChallengeBatch(claim, 'second', 'verified-probe')]);
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(JSON.parse(await readFile(claim, 'utf8'))).toMatchObject({ guidanceSwarmId: 'verified-probe', kinds: ['pelican', 'canvas'], hardCeilingTotalMicros: 100_000_000, automaticRetry: false });
      await expect(claimChallengeBatch(claim, 'third', 'different-probe')).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('all three tasks use only two Opus peers with fixed small working targets and hard caps', async () => {
    const specs = await Promise.all(retestKinds.map(retestSpec));
    for (const spec of specs) expect(spec).toMatchObject({ agentCount: 2, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' }, budgetMicros: 6_000_000, workingTargetMicros: 1_000_000, maxOutputTokens: 4096, maxTurnsPerAgent: 12, maxRunMs: 300_000 });
    expect(specs.map(spec => spec.finalOutput)).toEqual(['budget-report.md', 'pelican.svg', 'shared/hero.html']);
    expect(specs.reduce((sum, spec) => sum + spec.budgetMicros, 0)).toBe(18_000_000);
  });
  test('a durable claim rejects sequential and concurrent attempts even with different output directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swarm-retest-'));
    try {
      const path = join(root, 'claim.json');
      const outcomes = await Promise.allSettled([claimRetestBatch(path, 'first'), claimRetestBatch(path, 'second')]);
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const before = await readFile(path, 'utf8');
      await expect(claimRetestBatch(path, 'third')).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('copies only original canvas references and rejects missing source evidence', async () => {
    const store = openSwarmStore(':memory:');
    try {
      const spec = await retestSpec('canvas');
      const source = store.createSwarm(spec, ['reference/original.png', 'reference/README.md', 'shared/hero.html'].map(path => ({ path, baseRevision: 0, contentBase64: Buffer.from(path).toString('base64') })));
      expect(canvasSeeds(store, source.id).map(file => file.path)).toEqual(['reference/original.png', 'reference/README.md']);
      const missing = store.createSwarm(spec);
      expect(() => canvasSeeds(store, missing.id)).toThrow('original reference');
    } finally { store.close(); }
  });
});
