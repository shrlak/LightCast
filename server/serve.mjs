// Browser/LAN server: `npm start`, then open http://<this-computer>:4317 on any device on the network.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddresses, startServer } from './app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 4317;

try {
  await startServer({ root, port, host: '0.0.0.0' });
  console.log(`LightCast running:\n  Console: http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  Remote:  http://${ip}:${port}/?view=remote   Stage: http://${ip}:${port}/?view=stage`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
