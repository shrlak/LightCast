// Every test runs with the Rust engine loaded (src/engine/freecast_engine.wasm), as the app does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initEngine } from '../src/engine';

await initEngine(readFileSync(fileURLToPath(new URL('../src/engine/freecast_engine.wasm', import.meta.url))));
