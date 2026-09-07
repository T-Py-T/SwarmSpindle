/** Runs browser validation against isolated fixtures; never starts a provider or worker. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target || process.argv.length !== 3) throw new Error('Supply a new private check directory.');
const directory = resolve(target);
await mkdir(directory, { mode: 0o700 });
const env = { ...process.env, SWARM_DATA_DIR: `${directory}/data` };
async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { env, stdout: 'inherit', stderr: 'inherit' });
  return child.exited;
}
if (await run(['tooling/verification-fixture.ts']) !== 0) throw new Error('Fixture creation failed.');
const manifest = await Bun.file(`${env.SWARM_DATA_DIR}/verification-fixtures.json`).json();
for (const fixture of manifest.fixtures) {
  const output = `${directory}/${fixture.kind}`;
  const code = await run(['tooling/verify-artifact.ts', fixture.swarmId, fixture.kind, output]);
  const report = await Bun.file(`${output}/verification.json`).json();
  const failed = Object.entries(report.checks).filter(([, passed]) => passed !== true).map(([name]) => name).sort();
  if (code !== 1 || report.failure !== null || report.providerCallsInitiated !== 0 || JSON.stringify(failed) !== JSON.stringify(fixture.expectedFailedChecks)) {
    throw new Error(`Unexpected verifier result: ${JSON.stringify({ kind: fixture.kind, code, failure: report.failure, failed })}`);
  }
  console.log(JSON.stringify({ fixture: fixture.kind, browserChecksPassed: true, correctlyRejectedSyntheticModelEvidence: true }));
}
