import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface AppConfig { dataDirectory: string; databasePath: string; sessionDirectory: string; sandboxDirectory: string; port: number; previewPort: number }

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDirectory = resolve(env.SWARM_DATA_DIR ?? `${homedir()}/.local/share/simpleswarmsystem`);
  const port = parsePort(env.SWARM_PORT, 5178);
  const previewPort = parsePort(env.SWARM_PREVIEW_PORT, 5179);
  if (port === previewPort) throw new Error('The dashboard and artifact preview require different ports.');
  return { dataDirectory, databasePath: `${dataDirectory}/swarm.sqlite`, sessionDirectory: `${dataDirectory}/sessions`, sandboxDirectory: `${dataDirectory}/sandbox`, port, previewPort };
}

export function ensureDataDirectory(config: AppConfig): void {
  for (const directory of [config.dataDirectory, config.sessionDirectory, config.sandboxDirectory]) mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Ports must be integers between 1024 and 65535.');
  return port;
}
