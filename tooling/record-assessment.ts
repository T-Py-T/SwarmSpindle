import { openSwarmStore } from '@simpleswarm/swarm';
import { readConfig } from '../apps/shared/config.ts';

const [swarmId, receiptPath, ...extra] = process.argv.slice(2);
if (!swarmId || !receiptPath || extra.length) throw new Error('Usage: bun tooling/record-assessment.ts SWARM_ID REVIEW_JSON. Supply exact artifact/criteria hashes and evidence; this records an operator review, not an automatic quality verdict.');
const store = openSwarmStore(readConfig().databasePath);
try {
  const input: unknown = await Bun.file(receiptPath).json();
  console.log(JSON.stringify(store.recordArtifactAssessment(swarmId, input), null, 2));
} finally { store.close(); }
