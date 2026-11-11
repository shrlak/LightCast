// Builds the Rust PowerPoint engine (engine/) to WebAssembly and puts it where the app loads it
// from: src/engine/freecast_engine.wasm. That file is committed, so a machine without Rust still
// builds FreeCast; CI and the release workflow rebuild it from source.
//
//   npm run engine           build (needs cargo and the wasm32-unknown-unknown target)
//   npm run engine -- --if-available   build when cargo is there, else keep the committed file
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/engine/freecast_engine.wasm');
const optional = process.argv.includes('--if-available');

const hasCargo = spawnSync('cargo', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
if (!hasCargo) {
  if (optional) {
    console.log('cargo not found: keeping the committed src/engine/freecast_engine.wasm');
    process.exit(0);
  }
  console.error('cargo not found. Install Rust (https://rustup.rs) and run: rustup target add wasm32-unknown-unknown');
  process.exit(1);
}
// rustup may be missing where Rust came from a package manager; the build then says what is wrong.
spawnSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { stdio: 'inherit', shell: process.platform === 'win32' });
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'freecast-engine', '--manifest-path', join(root, 'engine/Cargo.toml')], { stdio: 'inherit', shell: process.platform === 'win32' });
copyFileSync(join(root, 'engine/target/wasm32-unknown-unknown/release/freecast_engine.wasm'), out);
console.log(`engine → src/engine/freecast_engine.wasm (${Math.round(statSync(out).size / 1024)} KB)`);
