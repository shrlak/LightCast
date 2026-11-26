// Stress: sync through a bad network (see tests/helpers/syncSession.ts for what every session checks).
// Deep run: SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { scenario, timeoutFor } from './helpers/stress';
import { syncSession } from './helpers/syncSession';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sync stress: faults', () => {
  it('the church server goes down and comes back while devices keep editing offline', () =>
    scenario('server outages', (r) => syncSession(r, { devices: [2, 3], outages: 0.25, deletes: true }).then(() => undefined)), timeoutFor(80));
  it('answers lost after the server applied the request (a write that looks failed)', () =>
    scenario('lost answers', (r) => syncSession(r, { devices: [2, 3], lostAnswers: 0.15 }).then(() => undefined)), timeoutFor(80));
  it('another device writes between this device reading and writing (409 races)', () =>
    scenario('write races', (r) => syncSession(r, { devices: [2, 4], races: 0.5 }).then(() => undefined)), timeoutFor(120));
  it('the person keeps typing while a sync round is in flight: no keystroke is lost', () =>
    scenario('typing during a round', (r) => syncSession(r, { devices: [2, 3], typing: 0.35 }).then(() => undefined)), timeoutFor(80));
  it('everything at once: outages, lost answers, races, typing, deletions', () =>
    scenario('all faults', (r) => syncSession(r, { devices: [2, 4], outages: 0.15, lostAnswers: 0.1, races: 0.3, typing: 0.2, deletes: true, elements: true, settings: true }).then(() => undefined)), timeoutFor(150));
});
