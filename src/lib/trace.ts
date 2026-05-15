/**
 * HER — Request Trace (Step 18.2)
 *
 * Minimal request-scoped profiler. Single source of truth for the
 * `[HER Trace]` log line so every stage is timestamped consistently.
 *
 * Design notes:
 *   - Pure utility: no I/O beyond console.log. Safe in any runtime
 *     (Edge, Node, tests).
 *   - We use performance.now() when available; in older runtimes we
 *     fall back to Date.now() so tests don't need polyfills.
 *   - Stage names are conventionally snake_case so they're easy to
 *     grep and to feed into log queries later.
 *   - The trace never throws — observability must never break the
 *     thing it's observing.
 */

const RUNTIME_HAS_PERF =
  typeof performance !== "undefined" && typeof performance.now === "function";

function nowMs(): number {
  return RUNTIME_HAS_PERF ? performance.now() : Date.now();
}

export interface RequestTrace {
  /** Short id (8 hex chars) shared by every stage in this request. */
  readonly traceId: string;
  /** Log a stage with optional structured extras. */
  stage(name: string, extra?: Record<string, unknown>): void;
  /** Final summary line — also returns the total ms for callers. */
  end(extra?: Record<string, unknown>): number;
}

function shortId(): string {
  // crypto.randomUUID exists in modern Node and the Edge runtime; fall back
  // to a Math.random hex if the runtime is older (e.g. legacy test envs).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padStart(8, "0");
}

export function createTrace(label = "HER Trace"): RequestTrace {
  const traceId = shortId();
  const startedAt = nowMs();

  return {
    traceId,
    stage(name, extra) {
      try {
        const elapsed = Math.round(nowMs() - startedAt);
        // Keep the JSON shape compact — log scrapers love a flat object.
        console.log(`[${label}]`, {
          traceId,
          stage: name,
          ms: elapsed,
          ...(extra ?? {}),
        });
      } catch {
        // Never let logging crash a request.
      }
    },
    end(extra) {
      const elapsed = Math.round(nowMs() - startedAt);
      try {
        console.log(`[${label}]`, {
          traceId,
          stage: "request_end",
          ms: elapsed,
          ...(extra ?? {}),
        });
      } catch {
        // ignore
      }
      return elapsed;
    },
  };
}
