/**
 * HER — Conversation Lifecycle & Continuity Intelligence (Step 17.7)
 *
 * Pure, deterministic logic that classifies a conversation thread by how
 * fresh its last interaction is, so the cron nudge worker can decide
 * whether to continue the existing thread or treat outreach as a fresh
 * opener.
 *
 * No DB calls, no LLM calls, no side effects — just timestamps and rules.
 */

// ── Types ──────────────────────────────────────────────────

export type ConversationState =
  | "active"        // < 24h since last interaction
  | "cooling"       // 24h–48h
  | "dormant"       // 48h–72h
  | "reengageable"; // >= 72h

export interface ConversationLifecycle {
  state: ConversationState;
  /** ISO timestamp of the most recent user/assistant interaction. */
  lastInteractionAt: string;
  /** ISO timestamp at which the thread is no longer eligible for continuity (48h after last). */
  continuityExpiresAt: string;
  /** ISO timestamp at which the thread crosses into dormant (48h after last). */
  dormantAt: string;
}

// ── Boundaries (kept as named constants so tests pin them) ─

const HOUR_MS = 60 * 60 * 1000;

/** A thread is "active" while the last interaction is younger than this. */
export const ACTIVE_WINDOW_MS = 24 * HOUR_MS;
/** Continuity-style outreach is allowed up to this age (active + cooling). */
export const CONTINUITY_WINDOW_MS = 48 * HOUR_MS;
/** Dormant boundary — thread is considered cold past this. */
export const DORMANT_WINDOW_MS = 72 * HOUR_MS;

// ── Pure Rules ─────────────────────────────────────────────

/**
 * Classify a thread by how long it has been since the last interaction.
 *
 * Boundaries (lower-inclusive, upper-exclusive):
 *   < 24h        → active
 *   [24h, 48h)   → cooling
 *   [48h, 72h)   → dormant
 *   >= 72h       → reengageable
 */
export function getConversationState(
  lastInteractionAt: Date,
  now: Date = new Date(),
): ConversationState {
  const ageMs = now.getTime() - lastInteractionAt.getTime();
  // Defensive: future timestamps (clock skew) collapse to active.
  if (ageMs < ACTIVE_WINDOW_MS) return "active";
  if (ageMs < CONTINUITY_WINDOW_MS) return "cooling";
  if (ageMs < DORMANT_WINDOW_MS) return "dormant";
  return "reengageable";
}

/**
 * Build a full lifecycle descriptor for a conversation. Useful for logging
 * and for downstream code that wants to reason about expiry timestamps
 * rather than re-deriving them.
 */
export function buildConversationLifecycle(
  lastInteractionAt: Date,
  now: Date = new Date(),
): ConversationLifecycle {
  const state = getConversationState(lastInteractionAt, now);
  const lastMs = lastInteractionAt.getTime();
  return {
    state,
    lastInteractionAt: lastInteractionAt.toISOString(),
    continuityExpiresAt: new Date(lastMs + CONTINUITY_WINDOW_MS).toISOString(),
    dormantAt: new Date(lastMs + DORMANT_WINDOW_MS).toISOString(),
  };
}

/**
 * Whether HER should write a continuity-style outreach message
 * (referencing the prior thread) versus a cold opener.
 *
 * True for `active` and `cooling` — the thread is still emotionally warm
 * enough that referencing it feels natural rather than stale.
 */
export function canUseContinuityStyle(
  lifecycle: ConversationLifecycle | ConversationState,
): boolean {
  const state = typeof lifecycle === "string" ? lifecycle : lifecycle.state;
  return state === "active" || state === "cooling";
}
