/**
 * HER — Spontaneous Outreach Eligibility (Step 17.8)
 *
 * Pure decision logic that decides whether HER should reach out on a given
 * cron tick — and what kind of outreach (continuity vs fresh) it should be.
 *
 * No DB calls, no LLM calls, no side effects. The cron worker calls this
 * after its existing safety gates (notification settings, quiet hours,
 * nudge limits) and uses the result to skip silently or to pick a brief.
 */

import {
  type ConversationLifecycle,
  type OutreachType,
  getOutreachType,
} from "./conversation-lifecycle";

/** Reason returned when an outreach is suppressed. Mirrors the log surface. */
export type OutreachSuppression =
  | "fatigue"
  | "dormant_skip"
  | "notifications_disabled";

export interface SpontaneousDecision {
  allowed: boolean;
  outreachType: OutreachType;
  /** Populated only when allowed === false. */
  suppressedReason?: OutreachSuppression;
}

export interface SpontaneousInputs {
  lifecycle: ConversationLifecycle;
  /** Count of low-priority pings the user has ignored in the last 24h. */
  ignoredCount24h: number;
  /** Whether the user has notifications enabled at all. */
  notificationsEnabled: boolean;
  /**
   * Optional random source — pass a fixed value in tests to make the
   * "dormant rare" branch deterministic. Defaults to Math.random().
   */
  random?: () => number;
}

/** Probability that a dormant-state outreach is permitted on a given tick. */
const DORMANT_RARE_RATE = 0.2;

/**
 * Decide whether HER may send a spontaneous outreach right now.
 *
 * Allowed by lifecycle:
 *   active      → yes (continuity)
 *   cooling     → yes (continuity)
 *   dormant     → rare (continuity-shaped, but mostly skipped)
 *   reengageable → yes (fresh)
 *
 * Always blocked when:
 *   - notifications disabled
 *   - user ignored ≥3 low-priority pings in the last 24h (fatigue)
 *
 * Note: this function does NOT cover quiet hours, nudge cap, or
 * active-chat suppression — those are upstream gates owned by the cron.
 */
export function canSendSpontaneousOutreach(
  inputs: SpontaneousInputs,
): SpontaneousDecision {
  const outreachType = getOutreachType(inputs.lifecycle);

  if (!inputs.notificationsEnabled) {
    return { allowed: false, outreachType, suppressedReason: "notifications_disabled" };
  }

  if (inputs.ignoredCount24h >= 3) {
    return { allowed: false, outreachType, suppressedReason: "fatigue" };
  }

  if (inputs.lifecycle.state === "dormant") {
    const rand = inputs.random ?? Math.random;
    if (rand() >= DORMANT_RARE_RATE) {
      return { allowed: false, outreachType, suppressedReason: "dormant_skip" };
    }
  }

  return { allowed: true, outreachType };
}

// ── Prompt Briefs ──────────────────────────────────────────

/**
 * Brief appended to the system prompt when continuing an active/cooling
 * thread. Keeps continuity-style outreach feeling like a continuation
 * rather than a cold opener.
 */
export const CONTINUITY_BRIEF = `This conversation thread is still emotionally active.
Continue naturally from the existing energy.
Avoid sounding like a fresh opener.
Avoid generic greetings.`;

/**
 * Brief appended to the system prompt when restarting after a thread has
 * naturally cooled. Stops HER from faking continuity that no longer exists.
 */
export const FRESH_BRIEF = `The previous conversation naturally cooled down.
This message should feel like a spontaneous new interaction.
Do not force continuity from old minor topics.
Avoid pretending the silence never happened.`;

/** Pick the right brief for a given outreach type. */
export function briefForOutreach(type: OutreachType): string {
  return type === "continuity" ? CONTINUITY_BRIEF : FRESH_BRIEF;
}
