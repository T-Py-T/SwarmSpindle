import { mkdir, copyFile } from 'node:fs/promises';
const outdir = new URL('../dist/web/',import.meta.url).pathname;
await mkdir(outdir,{recursive:true});
const result=await Bun.build({entrypoints:[new URL('../apps/web/app.ts',import.meta.url).pathname],target:'browser',outdir,minify:true,sourcemap:'external'});
if(!result.success){console.error(result.logs);process.exit(1);}
for(const name of ['index.html','styles.css']) await copyFile(new URL(`../apps/web/${name}`,import.meta.url),`${outdir}/${name}`);
console.log(`Built dashboard: ${result.outputs.length} bundled assets.`);
