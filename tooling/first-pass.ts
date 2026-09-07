export {};
const commands = [
  ['bun','install'],
  ['bun','run','typecheck'],
  ['bun','test','tests/swarm.test.ts','tests/sandbox.test.ts','tests/runtime-pricing.test.ts','tests/runtime-budget.test.ts','tests/runtime-tools.test.ts','tests/cli.test.ts'],
  ['bun','test','tests/sandbox.integration.test.ts'],
  ['bun','run','build'],
];
let failed=false;
for(const [index,command] of commands.entries()){
  console.log(JSON.stringify({step:command}));
  const child=Bun.spawn(command,{stdout:'inherit',stderr:'inherit',env:{...process.env,SIMPLESWARM_SANDBOX_INTEGRATION:'1'}});
  const code=await child.exited;
  console.log(JSON.stringify({step:command,exitCode:code}));
  if(code!==0){failed=true;if(index===0)break;}
}
process.exitCode=failed?1:0;
