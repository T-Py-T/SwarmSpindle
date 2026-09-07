import { randomUUID } from 'node:crypto';
import { openSwarmStore } from '@simpleswarm/swarm';
import { createPodmanSandbox } from '@simpleswarm/sandbox';
import { createPiRuntime } from '@simpleswarm/runtime';
import { ensureDataDirectory, readConfig } from '../shared/config.ts';
import { createWorkerScheduler } from './scheduler.ts';

const config = readConfig(); ensureDataDirectory(config);
const store = openSwarmStore(config.databasePath);
const sandbox = createPodmanSandbox({ runtimeDirectory: config.sandboxDirectory, maxConcurrent: 4 });
const runtime = createPiRuntime({ store, sandbox, sessionDirectory: config.sessionDirectory });
const workerId = `worker-${randomUUID()}`;
const scheduler = createWorkerScheduler({ store, sandbox, runtime, workerId, pid: process.pid,
  maxConcurrentSwarms: Number(process.env.SWARM_MAX_CONCURRENT ?? 2),
  reportError: error => console.error(JSON.stringify({ kind: 'worker_error', workerId, reason: error instanceof Error ? error.message : 'Unknown failure' })),
});
let shuttingDown = false;
const stop = () => { shuttingDown = true; void scheduler.shutdown().catch(error => console.error(error)); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);

try {
  scheduler.start();
  console.log(JSON.stringify({ kind: 'worker_online', workerId }));
  while (!shuttingDown) {
    await scheduler.tick();
    await Bun.sleep(500);
  }
} finally {
  try { await scheduler.shutdown(); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); store.close(); }
}
