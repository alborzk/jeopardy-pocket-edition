import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLanAddresses } from './lan';
import { startServer } from './server';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
// Running the TypeScript source (pnpm dev) rather than the built dist/index.js.
const fromSource = import.meta.url.endsWith('.ts');

// Both src/index.ts (dev) and dist/index.js (built) sit two levels below apps/, next to ../client.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(process.env.CLIENT_DIST ?? path.join(here, '../../client/dist'));
// In development Vite serves the live client, and a leftover build here is almost always stale,
// so only the built server hands out the built client.
const staticDir =
  !fromSource && existsSync(path.join(clientDist, 'index.html')) ? clientDist : null;

const server = await startServer({ port, host, staticDir });

const lan = getLanAddresses();
console.log(`Jeepy Party! server listening on port ${server.port}`);
console.log(`  Local:   http://localhost:${server.port}`);
if (fromSource) {
  // In development the client is served by Vite, which proxies the socket to this server.
  const clientPort = Number(process.env.DEV_CLIENT_PORT ?? 5173);
  console.log('  Phones on the same Wi-Fi can join at:');
  for (const address of lan) console.log(`    http://${address}:${clientPort}`);
} else if (staticDir) {
  console.log('  Phones on the same Wi-Fi can join at:');
  for (const address of lan) console.log(`    http://${address}:${server.port}`);
} else {
  console.warn(`  No client build found at ${clientDist}. Run "pnpm build" first.`);
}

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
