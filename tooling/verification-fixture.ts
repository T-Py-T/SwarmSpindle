/** Browser-verifier fixtures only. These records are deliberately missing real model-response evidence. */
import { mkdir, writeFile } from 'node:fs/promises';
import { openSwarmStore, parseSwarmSpec } from '@simpleswarm/swarm';
import { readConfig } from '../apps/shared/config.ts';

if (process.argv.length !== 2 || !process.env.SWARM_DATA_DIR) throw new Error('Usage: SWARM_DATA_DIR=NEW_ISOLATED_DIRECTORY bun run tooling/verification-fixture.ts');
const config = readConfig();
if (config.dataDirectory === readConfig({}).dataDirectory) throw new Error('Fixture creation cannot use the default data directory.');
// Exclusive creation prevents mixing these synthetic records with existing operator data.
await mkdir(config.dataDirectory, { mode: 0o700 });
const store = openSwarmStore(config.databasePath);
const fixtureWorker = 'synthetic-browser-verifier-fixture';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<title>Synthetic SVG browser fixture; not pelican acceptance</title>
<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#08203d"/><stop offset="1" stop-color="#50b6d1"/></linearGradient></defs>
<rect width="1200" height="800" fill="url(#sky)"/>
<circle cx="910" cy="180" r="110" fill="#ffe08a"/>
<path d="M0 650L280 300L530 660L760 400L1200 730V800H0Z" fill="#203c56"/>
<path d="M0 700Q300 500 600 720T1200 620V800H0Z" fill="#42aa9f"/>
<text x="60" y="100" fill="white" font-family="sans-serif" font-size="42">SYNTHETIC SVG VERIFICATION FIXTURE</text>
</svg>`;

const canvas = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic canvas browser fixture</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#06182e}canvas{display:block;width:100vw;height:100vh}</style>
<canvas aria-label="Synthetic animated test pattern; not reference acceptance"></canvas>
<script>
'use strict';
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
function resize(){canvas.width=Math.round(innerWidth*devicePixelRatio);canvas.height=Math.round(innerHeight*devicePixelRatio);}
addEventListener('resize',resize);resize();
function frame(timestamp){
  const width=innerWidth,height=innerHeight,time=timestamp/1000;
  context.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  context.fillStyle='hsl('+((time*37)%360)+',60%,22%)';context.fillRect(0,0,width,height);
  for(let i=0;i<40;i++){
    const phase=time*(0.3+i/200)+i*2.399;
    const x=width*(0.5+0.42*Math.sin(phase));const y=height*(0.5+0.4*Math.cos(phase*1.3));
    context.beginPath();context.arc(x,y,12+(i%5)*7,0,Math.PI*2);
    context.fillStyle='hsl('+((i*31+time*23)%360)+',85%,70%)';context.fill();
  }
  context.fillStyle='white';context.font='22px sans-serif';context.fillText('SYNTHETIC CANVAS VERIFICATION FIXTURE',24,38);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></html>`;

try {
  store.registerWorker(fixtureWorker, process.pid);
  const fixtures = [];
  for (const [kind, source] of [['svg', svg], ['canvas', canvas]] as const) {
    const path = kind === 'svg' ? 'fixture.svg' : 'fixture.html';
    const run = store.createSwarm(parseSwarmSpec({
      title: `SYNTHETIC ${kind.toUpperCase()} verifier fixture — no provider calls`,
      task: 'Exercise the operator browser verifier. This is manually seeded fixture data, not model output.',
      definitionOfDone: 'The synthetic artifact is stored in a terminal fixture record. Real model-response verification must fail.',
      finalOutput: path, agentCount: 1,
      model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
      budgetMicros: 1_000_000,
    }));
    store.seedFiles(run.id, [{ path, baseRevision: 0, contentBase64: Buffer.from(source).toString('base64') }]);
    if (store.claimNextSwarm(fixtureWorker)?.id !== run.id) throw new Error('Fixture claimed an unexpected run.');
    const agent = run.agents[0];
    if (!agent) throw new Error('Fixture agent missing.');
    const actor = { swarmId: run.id, agentId: agent.id };
    store.startAgent(actor, `SYNTHETIC-NOT-A-PI-SESSION/${kind}/${run.id}`);
    store.appendEvent(run.id, agent.id, 'verification_fixture', { synthetic: true, providerCalls: 0, realSession: false });
    store.endAgent(actor, 'done', 'Synthetic fixture creation complete; no Pi session or inference was executed.');
    store.finishSwarm(run.id, 'completed', 'SYNTHETIC fixture only. Not eligible for real swarm acceptance.');
    const reservations = store.reservations(run.id);
    const modelResponses = store.events(run.id).filter(event => event.kind === 'model_response');
    if (reservations.length || modelResponses.length) throw new Error('Fixture unexpectedly contains provider evidence or reservations.');
    fixtures.push({ kind, swarmId: run.id, finalOutput: path, synthetic: true,
      expectedVerifierExitCode: 1, expectedFailedChecks: ['allAgentsHaveVerifiedModelResponses'],
      reservations: reservations.length, realModelResponses: modelResponses.length });
  }
  store.offlineWorker(fixtureWorker);
  const manifest = { dataDirectory: config.dataDirectory, synthetic: true, providerCallsInitiated: 0,
    warning: 'Never use these fixtures as real session, real model, budget-spend, or visual-fidelity acceptance evidence.', fixtures };
  await writeFile(`${config.dataDirectory}/verification-fixtures.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(manifest, null, 2));
} finally { store.close(); }
