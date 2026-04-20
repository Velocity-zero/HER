/**
 * HER — Dynamic Response Mode Selection (Step 21 Part B)
 *
 * Selects the optimal response mode based on:
 *   - Current conversation context
 *   - User's interaction patterns (Part A)
 *   - Recent engagement signals
 *
 * This makes HER adaptive — mirroring the user's style naturally.
 */

import type { InteractionPattern } from "./interaction-patterns";
import type { ConversationContinuity } from "./continuity";

// ── Types ──────────────────────────────────────────────────

export type ResponseMode =
  | "conversational"  // default natural chat
  | "concise"         // short, task-focused
  | "expressive"      // emotional moments, more depth
  | "passive"         // low engagement, don't push
  | "re-engaging";    // user drifting, gentle pull-back

export interface ResponseModeContext {
  continuity: ConversationContinuity;
  patterns: InteractionPattern | null;
  timeSinceLastMessage?: number; // ms
  isAuthenticated: boolean;
}

// ── Mode Selection ─────────────────────────────────────────

/**
 * Select the best response mode given current context and patterns.
 * Returns the mode + a brief instruction to inject into the system prompt.
 */
export function selectResponseMode(ctx: ResponseModeContext): {
  mode: ResponseMode;
  instruction: string;
} {
  // Guests / early conversations → default
  if (!ctx.isAuthenticated || !ctx.patterns) {
    return { mode: "conversational", instruction: "" };
  }

  const { continuity, patterns, timeSinceLastMessage } = ctx;

  // ── Re-engaging: user went quiet for a while ──
  if (timeSinceLastMessage && timeSinceLastMessage > 600_000 && continuity.turnCount > 3) {
    return {
      mode: "re-engaging",
      instruction: "The user came back after a pause. Acknowledge the gap subtly (not dramatically), and make it easy for them to jump back in. Don't ask what happened.",
    };
  }

  // ── Passive: user is giving minimal engagement ──
  if (
    patterns.stylePreference.messageLength === "short" &&
    !patterns.engagementLevel.respondsToQuestions &&
    continuity.turnCount > 4
  ) {
    return {
      mode: "passive",
      instruction: "The user is giving short, low-effort replies. Match their energy — keep responses brief, don't ask many questions, don't push for engagement. Just be present.",
    };
  }

  // ── Concise: user is task-focused ──
  if (
    patterns.engagementLevel.dominantMode === "task-focused" ||
    continuity.lastUserIntent === "practical" ||
    continuity.lastUserIntent === "technical"
  ) {
    const isShortStyle = patterns.stylePreference.messageLength === "short";
    return {
      mode: "concise",
      instruction: isShortStyle
        ? "The user prefers short, direct interactions. Be helpful and efficient — skip the personality fluff. Lists and structure are fine."
        : "The user is in problem-solving mode. Be useful first, personality second. Structure is welcome.",
    };
  }

  // ── Expressive: emotional moment ──
  if (
    continuity.recentTone === "heavy" ||
    continuity.recentTone === "frustrated" ||
    continuity.recentTone === "uncertain" ||
    patterns.engagementLevel.dominantMode === "emotional"
  ) {
    // But if they ghost after heavy topics, don't go deep
    if (patterns.responseBehavior.ghostsAfterHeavy) {
      return {
        mode: "conversational",
        instruction: "The user seems to be dealing with something, but historically they pull away after heavy topics. Be warm but keep it light — don't push too deep.",
      };
    }
    return {
      mode: "expressive",
      instruction: "The user is in an emotional space. Increase depth slightly — more empathy, more presence. Don't overdo it. Don't make it dramatic. Just be genuinely there.",
    };
  }

  // ── Default: conversational ──
  // Adapt length to match their style
  const lengthHint =
    patterns.stylePreference.messageLength === "short"
      ? " Keep responses on the shorter side — they prefer brief exchanges."
      : patterns.stylePreference.messageLength === "long"
      ? " They tend to write longer messages — feel free to match that depth when it fits."
      : "";

  return {
    mode: "conversational",
    instruction: lengthHint ? `Adapt to their style.${lengthHint}` : "",
  };
}
