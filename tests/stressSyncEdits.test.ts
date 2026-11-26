// Stress: devices editing the same library at once (see tests/helpers/syncSession.ts for what every session checks).
// Deep run: SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { scenario, timeoutFor } from './helpers/stress';
import { syncSession } from './helpers/syncSession';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sync stress: editing on several devices at once', () => {
  it('2–4 devices editing titles and slide text: one library, every part its latest edit', () =>
    scenario('concurrent edits', (r) => syncSession(r, { devices: [2, 4] }).then(() => undefined)), timeoutFor(80));
  it('deleting presentations and slides while others edit them: the later of deletion and edit wins', () =>
    scenario('deletes vs edits', (r) => syncSession(r, { devices: [2, 3], deletes: true }).then(() => undefined)), timeoutFor(80));
  it('text boxes on the same slide edited on different devices: each box its latest edit', () =>
    scenario('text boxes', (r) => syncSession(r, { devices: [2, 3], elements: true }).then(() => undefined)), timeoutFor(80));
  it('주일예배 settings changed on several devices: each setting its latest edit', () =>
    scenario('service settings', (r) => syncSession(r, { devices: [2, 3], settings: true }).then(() => undefined)), timeoutFor(80));
});
