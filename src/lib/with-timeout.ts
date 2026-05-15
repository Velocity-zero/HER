/**
 * HER — withTimeout (Step 18.2)
 *
 * Race a promise against a timeout. On timeout we resolve to a caller-
 * provided fallback value AND log a `[HER Timeout]` line so the trace
 * shows which subsystem stalled.
 *
 * Why this shape (resolve, not reject):
 *   The whole point of this utility is graceful degradation. The chat
 *   pipeline calls many side-systems (memory, signals, self-state,
 *   continuity) and any one of them stalling for the LLM's sake is
 *   unacceptable. Returning a fallback lets the caller keep going.
 *
 * Why we don't wrap aborts:
 *   The underlying promise keeps running after we've returned the
 *   fallback. That's fine — its result will just be discarded. We
 *   intentionally avoid AbortController plumbing here because most of
 *   the systems we wrap don't accept signals, and a partial-cancel
 *   model would create silent state corruption.
 */

export interface TimeoutOptions<T> {
  /** Friendly label used in the log line and stack-style errors. */
  label: string;
  /** Milliseconds to wait before falling back. */
  ms: number;
  /** Value returned when the timeout wins the race. */
  fallback: T;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions<T>,
): Promise<T> {
  const { label, ms, fallback } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), ms);
  });

  try {
    const winner = await Promise.race([
      promise.then((v) => ({ value: v }) as { value: T }),
      timeoutPromise,
    ]);
    if ("__timeout" in winner) {
      console.warn(`[HER Timeout] ${label} exceeded ${ms}ms`);
      return fallback;
    }
    return winner.value;
  } catch (err) {
    // Underlying promise rejected — degrade to fallback, surface in logs.
    console.warn(`[HER Timeout] ${label} rejected — using fallback`, err);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
