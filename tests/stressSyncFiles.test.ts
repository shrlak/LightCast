// Stress: media files, fonts and skewed clocks across devices (see tests/helpers/syncSession.ts for the checks).
// Deep run: SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { scenario, timeoutFor } from './helpers/stress';
import { syncSession } from './helpers/syncSession';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sync stress: files and clocks', () => {
  it('pictures added on every device reach every device and the server', () =>
    scenario('media', (r) => syncSession(r, { devices: [2, 3], media: true }).then(() => undefined)), timeoutFor(80));
  it('media transfers that fail now and then are retried until every file is everywhere', () =>
    scenario('media faults', (r) => syncSession(r, { devices: [2, 3], media: true, mediaFaults: 0.25, outages: 0.1 }).then(() => undefined)), timeoutFor(100));
  it('fonts imported and removed on different devices end the same everywhere', () =>
    scenario('fonts', (r) => syncSession(r, { devices: [2, 3], fonts: true }).then(() => undefined)), timeoutFor(100));
  it('devices whose server-time estimate is off by up to ±0.4 s still converge on one of the latest edits', () =>
    scenario('clock skew', (r) => syncSession(r, { devices: [2, 4], skewMs: 400, deletes: true, elements: true }).then(() => undefined)), timeoutFor(100));
});
