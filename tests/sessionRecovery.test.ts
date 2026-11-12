import { describe, expect, it } from 'vitest';
import { endedBadly, STALE_MS } from '../src/domain/sessionRecovery';

describe('endedBadly', () => {
  it('is false on a first run and after a clean exit', () => {
    expect(endedBadly(null, 1_000_000)).toBe(false);
    expect(endedBadly({ at: 0, closed: true }, 1_000_000)).toBe(false);
  });
  it('is true when the last heartbeat is old and the run never closed', () => {
    expect(endedBadly({ at: 0, closed: false }, STALE_MS + 1)).toBe(true);
  });
  it('is false while another window is still beating', () => {
    expect(endedBadly({ at: 1000, closed: false }, 1000 + STALE_MS)).toBe(false);
  });
});
