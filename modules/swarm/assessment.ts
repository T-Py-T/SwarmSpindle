import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SwarmError, normalizeWorkspacePath, type ArtifactAssessment, type SwarmSpec, type WorkspaceFile } from './contracts.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const check = z.object({ name: z.string().trim().min(1).max(120), passed: z.boolean(), evidence: z.string().trim().min(1).max(10000) }).strict();
const checks = z.array(check).min(1).max(64).refine(value => new Set(value.map(item => item.name.toLowerCase())).size === value.length, 'Check names must be unique.');
const inputSchema = z.object({
  path: z.string().min(1).max(512), revision: z.number().int().nonnegative().safe(), sha256: digest.nullable(),
  definitionOfDoneSha256: digest, checks,
}).strict();
const storedSchema = inputSchema.extend({ createdAt: z.number().int().nonnegative().safe(), verdict: z.enum(['passed', 'failed']) });

function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }

function validBindingShape(value: Pick<ArtifactAssessment, 'path' | 'revision' | 'sha256'>): boolean {
  try { normalizeWorkspacePath(value.path); } catch { return false; }
  return value.revision === 0 ? value.sha256 === null : value.sha256 !== null;
}

export function assessmentMatches(assessment: Pick<ArtifactAssessment, 'path' | 'revision' | 'sha256' | 'definitionOfDoneSha256'>, spec: SwarmSpec, file: WorkspaceFile | undefined): boolean {
  return assessment.path === spec.finalOutput
    && assessment.definitionOfDoneSha256 === sha256(spec.definitionOfDone)
    && assessment.revision === (file?.revision ?? 0)
    && assessment.sha256 === (file ? sha256(Buffer.from(file.contentBase64, 'base64')) : null);
}

export function createArtifactAssessment(input: unknown, spec: SwarmSpec, file: WorkspaceFile | undefined, createdAt: number): ArtifactAssessment {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || !validBindingShape(parsed.data)) throw new SwarmError('invalid_assessment', 'Assessment requires bounded named checks and exact artifact and criteria hashes; verdict and timestamp are assigned by the store.');
  const assessment = parsed.data;
  if (!assessmentMatches(assessment, spec, file)) throw new SwarmError('assessment_stale', 'The assessed artifact or definition of done no longer matches the current run.');
  const verdict = assessment.checks.every(item => item.passed) ? 'passed' : 'failed';
  if (!file && verdict === 'passed') throw new SwarmError('assessment_missing_output', 'A missing expected output cannot receive a passing assessment.');
  const result: ArtifactAssessment = { ...assessment, createdAt, verdict };
  if (JSON.stringify(result).length > 1_000_000) throw new SwarmError('invalid_assessment', 'Serialized assessment exceeds its size limit.');
  return result;
}

export function readArtifactAssessment(body: string): ArtifactAssessment {
  if (body.length > 1_000_000) throw new SwarmError('corrupt_assessment', 'Stored assessment exceeds its size limit.');
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw new SwarmError('corrupt_assessment', 'Stored assessment JSON is invalid.'); }
  const parsed = storedSchema.safeParse(input);
  if (!parsed.success || !validBindingShape(parsed.data)
    || parsed.data.verdict !== (parsed.data.checks.every(item => item.passed) ? 'passed' : 'failed')
    || (parsed.data.revision === 0 && parsed.data.verdict === 'passed')) {
    throw new SwarmError('corrupt_assessment', 'Stored assessment does not contain a valid derived verdict and bounded evidence.');
  }
  return parsed.data;
}
