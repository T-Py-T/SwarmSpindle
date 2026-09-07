export {};

const commands = [
  ['bun', 'run', 'typecheck'],
  ['bun', 'run', 'build'],
  ['bun', 'test'],
];
let failed = false;
for (const command of commands) {
  console.log(JSON.stringify({ step: command }));
  const child = Bun.spawn(command, {
    stdout: 'inherit', stderr: 'inherit',
    env: { ...process.env, SIMPLESWARM_SANDBOX_INTEGRATION: '1' },
  });
  const exitCode = await child.exited;
  console.log(JSON.stringify({ step: command, exitCode }));
  if (exitCode !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
