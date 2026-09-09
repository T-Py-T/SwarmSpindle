import type { RunStatus, SwarmRecord } from '@simpleswarm/swarm';

export type OutcomeFilter = 'all' | 'active' | 'review' | 'incomplete';

interface RunDescription {
  label: string;
  explanation: string;
  group: Exclude<OutcomeFilter, 'all'>;
  targetReached: boolean;
}

const outcomes: Record<RunStatus, Omit<RunDescription, 'targetReached'>> = {
  queued: {
    label: 'Queued', group: 'active',
    explanation: 'Waiting for a worker slot. Model access and workspace checks happen before execution.',
  },
  running: {
    label: 'Running', group: 'active',
    explanation: 'A worker has claimed this swarm. Peers may be preparing, working, or waiting for request capacity.',
  },
  stopping: {
    label: 'Stopping', group: 'active',
    explanation: 'A stop was requested. Sessions and outstanding request accounting are being reconciled.',
  },
  completed: {
    label: 'Completion claimed · review required', group: 'review',
    explanation: 'All peers reported completion. Independent acceptance of the output has not been recorded here.',
  },
  budget_exhausted: {
    label: 'Request capacity exhausted', group: 'incomplete',
    explanation: 'Remaining capacity cannot fund another bounded request. A positive balance may remain.',
  },
  bailed: {
    label: 'Ended without completion', group: 'incomplete',
    explanation: 'The swarm ended without meeting its completion conditions. Inspect the recorded reason and peer conclusions.',
  },
  failed: {
    label: 'Failed', group: 'incomplete',
    explanation: 'Execution ended with a setup, runtime, accounting, or stalled-peer failure. Inspect the recorded reason.',
  },
  interrupted: {
    label: 'Interrupted', group: 'incomplete',
    explanation: 'Execution was interrupted. Outstanding request liabilities remain retained; the swarm is not automatically retried.',
  },
  cancelled: {
    label: 'Cancelled', group: 'incomplete',
    explanation: 'The swarm was cancelled before or during execution. Cancellation does not erase recorded usage or liabilities.',
  },
};

export function describeRun(run: SwarmRecord): RunDescription {
  return {
    ...outcomes[run.status],
    ...(run.status === 'completed' && run.artifactAssessment ? {
      label: 'Completion reported · artifact reviewed',
      explanation: 'All peers reported completion. The recorded artifact review is shown separately and does not change this run outcome.',
    } : {}),
    targetReached: run.spec.workingTargetMicros !== undefined
      && run.budget.settledMicros >= run.spec.workingTargetMicros,
  };
}

export function describeArtifactReview(run: SwarmRecord): {
  verdict: 'passed' | 'failed' | 'not_reviewed'; label: string; explanation: string;
} {
  if (!run.artifactAssessment) return {
    verdict: 'not_reviewed', label: 'Not reviewed',
    explanation: 'No current artifact review is recorded. An expected output path does not establish that a file exists or that the task succeeded.',
  };
  if (run.artifactAssessment.verdict === 'passed') return {
    verdict: 'passed', label: 'Passed',
    explanation: 'The recorded review passed its checks for the identified artifact and definition of done. This review does not change the run outcome.',
  };
  return {
    verdict: 'failed', label: 'Failed',
    explanation: 'The recorded artifact review failed. Inspect the criteria and evidence below; the run outcome is recorded separately.',
  };
}

export function summarizeRuns(runs: SwarmRecord[]): {
  total: number; active: number; review: number; incomplete: number;
  settledMicros: number; reservedMicros: number; uncertainMicros: number;
} {
  const summary = { total: runs.length, active: 0, review: 0, incomplete: 0, settledMicros: 0, reservedMicros: 0, uncertainMicros: 0 };
  for (const run of runs) {
    summary[outcomes[run.status].group] += 1;
    summary.settledMicros += run.budget.settledMicros;
    summary.reservedMicros += run.budget.reservedMicros;
    summary.uncertainMicros += run.budget.uncertainMicros;
  }
  return summary;
}
