// Browser side: fetch the engine once. Kept apart from index.ts so tests (Node) can load the engine
// from the file instead.
import url from './freecast_engine.wasm?url';
import { loadEngineFrom } from './index';

export const loadEngine = () => loadEngineFrom(url);
