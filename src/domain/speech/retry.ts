// Retry / backoff: pure, so tests can run it without waiting.
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
/** Wait before try number `attempt` (0 = first retry): 1 s, 2 s, 4 s … up to 30 s. Quota errors wait at least 10 s. */
export function backoffMs(attempt: number, quota = false): number {
  const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return quota ? Math.max(10_000, wait) : wait;
}

/** Run `fn`; on a failure `isRetryable` accepts, wait and try again up to `retries` times. */
export async function withRetry<T>(fn: () => Promise<T>, o: { retries: number; isRetryable: (e: unknown) => boolean; sleep: (ms: number) => Promise<void>; isCancelled?: () => boolean }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= o.retries || !o.isRetryable(e) || o.isCancelled?.()) throw e;
      await o.sleep(backoffMs(attempt));
    }
  }
}
