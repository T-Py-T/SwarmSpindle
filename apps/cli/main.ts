import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { openSwarmStore, parseSwarmSpec, normalizeWorkspacePath, type SwarmRecord } from '@simpleswarm/swarm';
import { createPodmanSandbox } from '@simpleswarm/sandbox';
import { createPiRuntime } from '@simpleswarm/runtime';
import { ensureDataDirectory, readConfig } from '../shared/config.ts';
import { parseDollars, parseModel, parsePrompt } from '../shared/prompt.ts';
import { readSeedDirectory } from '../shared/seeds.ts';

const help = `SwarmSpindle

  bun run swarm COUNT MODEL BUDGET PROMPT_PATH [--seed-dir DIRECTORY] [--working-target USD]
  bun run swarm status [SWARM_ID]
  bun run swarm stop SWARM_ID
  bun run swarm export SWARM_ID NEW_DIRECTORY
  bun run swarm doctor

Models: opus48 = Opus 4.8 High; gpt55 = GPT-5.5 High.
Budget: one shared USD-equivalent cap, e.g. 50.
Working target: optional smaller verified-usage stop threshold; in-flight requests may finish above it within the hard cap.
Prompt: Markdown containing "Final output: file.ext" and "## Definition of Done".
Run "bun run web" and "bun run worker" in separate terminals.
Storage: SWARM_DATA_DIR (default ~/.local/share/simpleswarmsystem).
`;

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help' || args[0] === 'help') { console.log(help); process.exit(0); }
const config = readConfig(); ensureDataDirectory(config);
const store = openSwarmStore(config.databasePath);
try {
  const command = args[0];
  if (command === 'status') {
    if (args.length > 2) throw new Error('Use status [SWARM_ID].');
    console.log(JSON.stringify(args[1] ? store.getSwarm(args[1]) : { workers: store.listWorkers(), swarms: store.listSwarms() }, null, 2));
  } else if (command === 'stop') {
    if (args.length !== 2) throw new Error('Use stop SWARM_ID.');
    console.log(JSON.stringify(store.stopSwarm(args[1]!, 'Stopped from the command line.'), null, 2));
  } else if (command === 'export') {
    if (args.length !== 3) throw new Error('Use export SWARM_ID NEW_DIRECTORY. Existing directories are never overwritten.');
    const run = store.getSwarm(args[1]!);
    const output = resolve(args[2]!);
    await mkdir(output, { mode: 0o700 });
    const workspace = `${output}/workspace`; await mkdir(workspace, { mode: 0o700 });
    for (const file of store.files(run.id)) {
      const path = `${workspace}/${normalizeWorkspacePath(file.path)}`;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, Buffer.from(file.contentBase64, 'base64'), { flag: 'wx', mode: 0o600 });
    }
    const traces = []; let after = 0;
    for (;;) { const page = store.events(run.id, after, 1000); traces.push(...page); if (page.length < 1000) break; after = page.at(-1)!.seq; }
    const receipt = { run, threads: store.threads(run.id).map(thread => ({ ...thread, messages: store.messages(run.id, thread.id) })), claims: store.claims(run.id), reservations: store.reservations(run.id), files: store.files(run.id).map(({contentBase64:_,...file})=>file) };
    await writeFile(`${output}/receipt.json`, JSON.stringify(receipt,null,2), { flag:'wx',mode:0o600 });
    await writeFile(`${output}/trace.jsonl`, traces.map(event=>JSON.stringify(event)).join('\n')+'\n', {flag:'wx',mode:0o600});
    console.log(`Exported ${run.id} to ${output}. Treat session content and task files as private until reviewed.`);
  } else if (command === 'doctor') {
    const sandbox = createPodmanSandbox({ runtimeDirectory: config.sandboxDirectory });
    const runtime = createPiRuntime({ store, sandbox, sessionDirectory: config.sessionDirectory });
    try {
      const isolation = await sandbox.check(); console.log(JSON.stringify({ sandbox:isolation },null,2));
      let ready = isolation.ready;
      for (const alias of ['opus48','gpt55']) {
        const spec = parseSwarmSpec({title:'Readiness check',task:'Check authentication without generation.',definitionOfDone:'Report exact model availability without inference.',finalOutput:'check.txt',agentCount:1,model:parseModel(alias),budgetMicros:50_000_000});
        const candidate: SwarmRecord = { id:'preflight-only',spec,status:'queued',createdAt:Date.now(),startedAt:null,endedAt:null,reason:null,workerId:null,agents:[],budget:{capMicros:spec.budgetMicros,settledMicros:0,reservedMicros:0,uncertainMicros:0,availableMicros:spec.budgetMicros} };
        const result = await runtime.preflight(candidate); console.log(JSON.stringify(result,null,2)); ready &&= result.ready;
      }
      if (!ready) process.exitCode=1;
    } finally { await runtime.dispose(); }
  } else {
    const launch = command === 'launch' ? args.slice(1) : args;
    if (launch.length < 4 || launch.length % 2 !== 0) throw new Error('Use COUNT MODEL BUDGET PROMPT_PATH [--seed-dir DIRECTORY] [--working-target USD].');
    const flags = new Map<string, string>();
    for (let index = 4; index < launch.length; index += 2) {
      const flag = launch[index]; const value = launch[index + 1];
      if (!flag || !['--seed-dir', '--working-target'].includes(flag) || !value || flags.has(flag)) throw new Error('Unknown, duplicated or incomplete launch option.');
      flags.set(flag, value);
    }
    const [count, model, budget, promptPath] = launch as [string,string,string,string];
    if (!/^\d+$/.test(count)) throw new Error('Agent count must be a positive integer.');
    const prompt = parsePrompt(await Bun.file(resolve(promptPath)).text());
    const seedDirectory = flags.get('--seed-dir');
    const seeds = seedDirectory ? await readSeedDirectory(seedDirectory) : [];
    const workingTarget = flags.get('--working-target');
    const title = prompt.task.split('\n').find(line=>line.trim())?.replace(/^#+\s*/, '').trim().slice(0,160) || 'New swarm';
    const run = store.createSwarm(parseSwarmSpec({ ...prompt, title,agentCount:Number(count),model:parseModel(model),budgetMicros:parseDollars(budget),...(workingTarget === undefined ? {} : { workingTargetMicros: parseDollars(workingTarget) }),maxOutputTokens:16000 }), seeds);
    console.log(JSON.stringify({id:run.id,status:run.status,model:run.spec.model,agents:run.spec.agentCount,capUsdEquivalent:run.spec.budgetMicros/1_000_000,workingTargetUsdEquivalent:run.spec.workingTargetMicros === undefined ? null : run.spec.workingTargetMicros/1_000_000,dashboard:`http://127.0.0.1:${config.port}/?swarm=${run.id}`},null,2));
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Command failed.'); process.exitCode=1; }
finally { store.close(); }
