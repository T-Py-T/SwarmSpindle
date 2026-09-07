import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSwarmStore } from '@simpleswarm/swarm';
import { parseDollars, parseModel, parsePrompt } from '../apps/shared/prompt.ts';

const roots: string[]=[];
const prompt = '# Pelican mission\n\nFinal output: pelican.svg\n\nDraw a pelican.\n\n## Definition of Done\n\nA valid self-contained SVG depicts a pelican riding a bicycle.';
async function fixture() { const path=await mkdtemp(join(tmpdir(),'swarm-cli-'));roots.push(path);await writeFile(join(path,'prompt.md'),prompt);return path; }
async function cli(root: string,...args:string[]) {
  const child=Bun.spawn([process.execPath,'run',new URL('../apps/cli/main.ts',import.meta.url).pathname,...args],{env:{...process.env,SWARM_DATA_DIR:join(root,'data')},stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};
}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('operator launch contract',()=>{
  test('requires an explicit done section and safe exact settings',()=>{
    expect(parsePrompt(prompt)).toEqual({task:prompt.split('## Definition')[0]!.trim(),definitionOfDone:'A valid self-contained SVG depicts a pelican riding a bicycle.',finalOutput:'pelican.svg'});
    expect(()=>parsePrompt('Draw something')).toThrow('Definition of Done');
    expect(parseDollars('50')).toBe(50_000_000);expect(parseDollars('0.01')).toBe(10_000);
    for(const value of ['0','-1','1e2','NaN','0.001'])expect(()=>parseDollars(value)).toThrow();
    expect(parseModel('opus48').id).toBe('claude-opus-4-8');expect(parseModel('gpt55').thinking).toBe('high');expect(()=>parseModel('latest')).toThrow('No model substitution');
  });
  test('queues exact thirty-agent settings and persists status without model work',async()=>{
    const root=await fixture();const launch=await cli(root,'30','opus48','50',join(root,'prompt.md'));expect(launch.code).toBe(0);
    const receipt=JSON.parse(launch.stdout);expect(receipt.agents).toBe(30);expect(receipt.capUsdEquivalent).toBe(50);expect(receipt.model).toEqual({provider:'anthropic',id:'claude-opus-4-8',thinking:'high'});
    const status=await cli(root,'status',receipt.id);expect(status.code).toBe(0);const run=JSON.parse(status.stdout);expect(run.status).toBe('queued');expect(run.agents).toHaveLength(30);expect(run.agents.every((agent:{sessionId:null})=>agent.sessionId===null)).toBe(true);expect(run.spec.finalOutput).toBe('pelican.svg');
    const stop=await cli(root,'stop',receipt.id);expect(stop.code).toBe(0);expect(JSON.parse(stop.stdout).status).toBe('cancelled');
  });
  test('invalid launches do not create a swarm',async()=>{
    const root=await fixture();for(const args of [['0','opus48','50'],['30','latest','50'],['30','gpt55','-1']])expect((await cli(root,...args,join(root,'prompt.md'))).code).toBe(1);
    expect(JSON.parse((await cli(root,'status')).stdout).swarms).toEqual([]);
  });
  test('uses a fallback title when a valid prompt begins with an empty heading',async()=>{
    const root=await fixture();await writeFile(join(root,'prompt.md'),prompt.replace('# Pelican mission','#'));
    const launch=await cli(root,'1','opus48','50',join(root,'prompt.md'));expect(launch.code).toBe(0);
    const run=JSON.parse((await cli(root,'status',JSON.parse(launch.stdout).id)).stdout);
    expect(run.spec.title).toBe('New swarm');expect(run.spec.task).toContain('Draw a pelican.');expect(run.status).toBe('queued');
  });
  test('exports byte-exact files and evidence into a new directory, never overwrites',async()=>{
    const root=await fixture();const launch=JSON.parse((await cli(root,'1','opus48','50',join(root,'prompt.md'))).stdout);
    const store=openSwarmStore(join(root,'data/swarm.sqlite'));
    const bytes=Buffer.from([0,1,255,4]);store.seedFiles(launch.id,[{path:'reference/sample.bin',baseRevision:0,contentBase64:bytes.toString('base64')}]);store.stopSwarm(launch.id,'Export fixture');store.close();
    const destination=join(root,'result');expect((await cli(root,'export',launch.id,destination)).code).toBe(0);expect(await readFile(join(destination,'workspace/reference/sample.bin'))).toEqual(bytes);
    expect(JSON.parse(await readFile(join(destination,'receipt.json'),'utf8')).run.id).toBe(launch.id);expect((await readFile(join(destination,'trace.jsonl'),'utf8')).length).toBeGreaterThan(0);
    await writeFile(join(destination,'sentinel'),'preserve');expect((await cli(root,'export',launch.id,destination)).code).toBe(1);expect(await readFile(join(destination,'sentinel'),'utf8')).toBe('preserve');
  });
});
