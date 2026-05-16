/**
 * HER — Cognitive Load Shedding (Step 18.3 / Phase C)
 *
 * When a request's assembled context exceeds the total token ceiling, we
 * progressively trim *optional* layers BEFORE the LLM call. The whole
 * point is: the user always gets a reply, even if a few intelligence
 * surfaces had to sit this one out.
 *
 * Hard rules:
 *   - Recent live dialogue is NEVER touched.
 *   - The system prompt (persona/style/reflection/anchor) is NEVER touched.
 *   - Active continuity (the part the model needs to keep the thread going)
 *     is touched LAST, and only by truncation — never dropped wholesale.
 *
 * Shedding order (least valuable first):
 *   1. interactionSignals    — "RECENT INTERACTION TEXTURE" block
 *   2. selfModelBrief        — "CURRENT CONVERSATIONAL TENDENCIES" block
 *   3. emotionContext        — emotional-history block
 *   4. memoryContext         — long-term facts (truncated head-keeping, not dropped)
 *   5. continuityContext     — last resort, only truncated
 *
 * This module is PURE: no I/O, no Date, no fetch. Easy to unit test, easy
 * to reason about. The chat route does the wiring.
 */

import { auditContext, estimateTokens, TOKEN_BUDGET } from "./context-budget";

export interface ShedInput {
  systemPrompt: string;
  historyText: string;
  /** Combined client-supplied continuity block (signals + self + etc are baked in). */
  continuityContext?: string | null;
  /** Long-term memory block. */
  memoryContext?: string | null;
  /** Future split-out layers — accepted for forward compatibility. */
  interactionSignals?: string | null;
  selfModelBrief?: string | null;
  emotionContext?: string | null;
  /** Override the hard total token ceiling for testing / per-request tuning. */
  totalBudgetTokens?: number;
}

export interface ShedReport {
  /** What we did, in shedding order. Empty when nothing got trimmed. */
  actionsApplied: string[];
  /** Token estimate before shedding. */
  beforeTokens: number;
  /** Token estimate after shedding. */
  afterTokens: number;
  /** Whether we still couldn't fit under the budget. */
  stillOverBudget: boolean;
}

export interface ShedResult {
  systemPrompt: string;
  historyText: string;
  memoryContext: string | null;
  continuityContext: string | null;
  interactionSignals: string | null;
  selfModelBrief: string | null;
  emotionContext: string | null;
  report: ShedReport;
}

/** Internal helper — keep the head portion of a string up to a char budget. */
function truncateHead(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  // Cut on a paragraph boundary if we can — looks much cleaner to the LLM.
  const slice = s.slice(0, maxChars);
  const lastBreak = slice.lastIndexOf("\n\n");
  return lastBreak > maxChars * 0.6 ? slice.slice(0, lastBreak) : slice;
}

/** Compute current total tokens for a given set of layers. */
function totalTokens(layers: {
  systemPrompt: string;
  historyText: string;
  memoryContext: string | null;
  continuityContext: string | null;
  interactionSignals: string | null;
  selfModelBrief: string | null;
  emotionContext: string | null;
}): number {
  return auditContext({
    systemPrompt: layers.systemPrompt,
    historyText: layers.historyText,
    memoryContext: layers.memoryContext,
    continuityContext: layers.continuityContext,
    interactionContext: layers.interactionSignals,
    selfModelBrief: layers.selfModelBrief,
    emotionContext: layers.emotionContext,
  }).estimatedTokens;
}

/**
 * Apply progressive load shedding until the total fits under the budget
 * (or every optional layer has been trimmed). Returns the trimmed payload
 * and a report of what happened.
 */
export function applyLoadShedding(input: ShedInput): ShedResult {
  const budget = input.totalBudgetTokens ?? TOKEN_BUDGET.total;

  // Working copies — we mutate these step by step.
  const layers = {
    systemPrompt: input.systemPrompt,
    historyText: input.historyText,
    memoryContext: input.memoryContext ?? null,
    continuityContext: input.continuityContext ?? null,
    interactionSignals: input.interactionSignals ?? null,
    selfModelBrief: input.selfModelBrief ?? null,
    emotionContext: input.emotionContext ?? null,
  };

  const beforeTokens = totalTokens(layers);
  const actions: string[] = [];

  // Early exit — common case, nothing to do.
  if (beforeTokens <= budget) {
    return {
      ...layers,
      report: { actionsApplied: [], beforeTokens, afterTokens: beforeTokens, stillOverBudget: false },
    };
  }

  // ── 1. drop interaction signals ──
  if (layers.interactionSignals) {
    layers.interactionSignals = null;
    actions.push("dropped:interactionSignals");
    if (totalTokens(layers) <= budget) return done();
  }

  // ── 2. drop self-model brief ──
  if (layers.selfModelBrief) {
    layers.selfModelBrief = null;
    actions.push("dropped:selfModelBrief");
    if (totalTokens(layers) <= budget) return done();
  }

  // ── 3. drop emotion context ──
  if (layers.emotionContext) {
    layers.emotionContext = null;
    actions.push("dropped:emotionContext");
    if (totalTokens(layers) <= budget) return done();
  }

  // ── 4. trim memory: halve, then quarter, then drop ──
  if (layers.memoryContext) {
    const original = layers.memoryContext;
    layers.memoryContext = truncateHead(original, Math.floor(original.length / 2));
    actions.push("trimmed:memoryContext:50%");
    if (totalTokens(layers) <= budget) return done();

    layers.memoryContext = truncateHead(original, Math.floor(original.length / 4));
    actions.push("trimmed:memoryContext:25%");
    if (totalTokens(layers) <= budget) return done();

    layers.memoryContext = null;
    actions.push("dropped:memoryContext");
    if (totalTokens(layers) <= budget) return done();
  }

  // ── 5. last resort — truncate continuity (never drop wholesale) ──
  if (layers.continuityContext) {
    const remaining = budget - totalTokens({ ...layers, continuityContext: null });
    if (remaining > 50) {
      // Keep what we can fit — at minimum a few hundred chars.
      const targetChars = Math.max(400, remaining * 4); // tokens→chars
      layers.continuityContext = truncateHead(layers.continuityContext, targetChars);
      actions.push("trimmed:continuityContext");
    }
  }

  return done();

  function done(): ShedResult {
    const after = totalTokens(layers);
    return {
      ...layers,
      report: {
        actionsApplied: actions,
        beforeTokens,
        afterTokens: after,
        stillOverBudget: after > budget,
      },
    };
  }
}

/**
 * Quick check: are we *near* the budget? Useful for proactive load
 * shedding before assembly grows further (e.g. ahead of a streaming reply
 * where token overflow would mid-stream the user).
 */
export function isNearBudget(systemPromptChars: number, threshold = 0.8): boolean {
  return estimateTokens(systemPromptChars.toString()) > TOKEN_BUDGET.total * threshold;
}
