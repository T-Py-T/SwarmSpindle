import { openSwarmStore } from '@simpleswarm/swarm';
import { ensureDataDirectory, readConfig } from '../shared/config.ts';
import { createWebServers } from './server.ts';

const config = readConfig();
ensureDataDirectory(config);
const bundle = await Bun.build({ entrypoints: [new URL('./app.ts', import.meta.url).pathname], target: 'browser', minify: true });
if (!bundle.success || !bundle.outputs[0]) throw new Error(`Dashboard build failed: ${bundle.logs.join('\n')}`);
const store = openSwarmStore(config.databasePath);
const servers = createWebServers({ store, port: config.port, previewPort: config.previewPort,
  html: await Bun.file(new URL('./index.html', import.meta.url)).text(), styles: await Bun.file(new URL('./styles.css', import.meta.url)).text(), script: await bundle.outputs[0].text(),
});
console.log(`SwarmSpindle: ${servers.origin}`);
const stop = () => { servers.stop(); store.close(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
