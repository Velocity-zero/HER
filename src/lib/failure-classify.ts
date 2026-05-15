/**
 * HER — Failure Classification (Step 18.2)
 *
 * Maps raw errors / responses into HER-internal codes so logs and
 * dashboards can attribute outages instead of seeing one giant blob
 * of "Internal Error". User-facing copy stays kind and short — the
 * codes only travel server-side.
 */

export type HerFailureCode =
  | "HER_TIMEOUT"           // any internal stage exceeded its budget
  | "HER_CONTEXT_LIMIT"     // estimated tokens above the hard ceiling
  | "HER_DB_TIMEOUT"        // Supabase / DB stage stalled
  | "HER_DATA_CORRUPTION"   // malformed historical data detected
  | "HER_PROVIDER_ERROR"    // upstream LLM provider non-2xx / empty
  | "HER_PROVIDER_RATE"     // upstream rate limit (retry-after)
  | "HER_STREAM_ABORT"      // client or upstream cut the stream mid-flight
  | "HER_UNKNOWN";          // last resort — never attribute blindly

export interface ClassifiedFailure {
  code: HerFailureCode;
  status: number;
  /** Short, user-facing copy. Stays in HER's voice (lowercase, casual). */
  userMessage: string;
  /** Server-only — not returned to the client. */
  internalReason: string;
}

/**
 * Order matters: we check the most specific signals first and fall
 * through to broader buckets. Add new patterns at the top of the file
 * region they belong to, not the bottom of the function.
 */
export function classifyFailure(err: unknown): ClassifiedFailure {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();

  // ── Provider-side ──
  if (lower.includes("429") || lower.includes("too many requests") || lower.includes("rate limit") || lower.includes("quota")) {
    return {
      code: "HER_PROVIDER_RATE",
      status: 429,
      userMessage: "okay hold on, too many messages at once — try again in like 30 seconds.",
      internalReason: msg,
    };
  }
  if (lower.includes("nvidia") || /api error \(5\d\d\)/i.test(msg) || lower.includes("empty response")) {
    return {
      code: "HER_PROVIDER_ERROR",
      status: 502,
      userMessage: "wait something broke on my end — try that again?",
      internalReason: msg,
    };
  }

  // ── Streaming abort (client closed, upstream cut) ──
  if (lower.includes("aborterror") || lower.includes("the operation was aborted") || lower.includes("body stream") || lower.includes("stream") && lower.includes("abort")) {
    return {
      code: "HER_STREAM_ABORT",
      status: 499,
      userMessage: "the connection cut off — wanna send that again?",
      internalReason: msg,
    };
  }

  // ── Timeouts (general + DB-flavored) ──
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    if (lower.includes("supabase") || lower.includes("postgres") || lower.includes("connection") || lower.includes("database")) {
      return {
        code: "HER_DB_TIMEOUT",
        status: 504,
        userMessage: "i'm a little slow right now — try again in a sec?",
        internalReason: msg,
      };
    }
    return {
      code: "HER_TIMEOUT",
      status: 504,
      userMessage: "i'm a little slow right now — try again in a sec?",
      internalReason: msg,
    };
  }

  // ── Context / token explosion ──
  if (lower.includes("context length") || lower.includes("maximum context") || lower.includes("token limit") || lower.includes("too many tokens")) {
    return {
      code: "HER_CONTEXT_LIMIT",
      status: 413,
      userMessage: "we've talked a lot — let me catch my breath, try again?",
      internalReason: msg,
    };
  }

  // ── Data shape problems ──
  if (lower.includes("unexpected token") || lower.includes("invalid json") || lower.includes("malformed") || lower.includes("unable to parse")) {
    return {
      code: "HER_DATA_CORRUPTION",
      status: 500,
      userMessage: "something on my side is tangled up — give me a moment, then try again.",
      internalReason: msg,
    };
  }

  return {
    code: "HER_UNKNOWN",
    status: 500,
    userMessage: "wait something broke on my end — try that again?",
    internalReason: msg || "unknown error",
  };
}
