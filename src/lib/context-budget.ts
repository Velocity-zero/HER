/**
 * HER — Context Budget (Step 18.2 — Phase A: audit only)
 *
 * Pure utilities for measuring prompt cost and reporting on it.
 *
 * Phase A scope:
 *   - estimateTokens()  — char/4 heuristic (good enough for triage)
 *   - auditContext()    — measures every layer + total, returns a flat report
 *
 * NOT yet implemented (Phase B, intentional):
 *   - trimming / sliding windows / priority-based eviction
 *   These require us to first read real traces and decide what to cut on
 *   each surface; cutting blindly would silently remove HER's intelligence.
 */

/** Soft per-system token guidelines. Used for reporting overage, not enforcement. */
export const TOKEN_BUDGET = {
  systemCore:        2_500,
  recentMessages:    6_000,
  memory:            2_000,
  interactionSignals:1_000,
  continuity:        1_200,
  selfModel:           400,
  emotion:             400,
  /** Hard ceiling for the assembled prompt. ~32k context window with headroom. */
  total:            24_000,
} as const;

/**
 * Cheap token estimator. Mistral/GPT tokenizers average ~4 chars per
 * token in English, slightly less for code/punctuation-dense text. We
 * round up so the audit errs on the side of caution.
 */
export function estimateTokens(input: string | null | undefined): number {
  if (!input) return 0;
  return Math.ceil(input.length / 4);
}

export interface ContextLayerSizes {
  systemPromptChars: number;
  historyChars: number;
  memoryChars: number;
  interactionSignalChars: number;
  continuityChars: number;
  selfModelChars: number;
  emotionChars: number;
}

export interface ContextAuditReport extends ContextLayerSizes {
  totalChars: number;
  estimatedTokens: number;
  /** Layers (by name) whose token count is above their soft guideline. */
  overBudgetLayers: string[];
  /** True when totalEstimatedTokens > TOKEN_BUDGET.total. */
  overTotalBudget: boolean;
}

/**
 * Build a single audit report from the assembled prompt pieces.
 * Pass null/undefined for layers that aren't in use this turn.
 */
export function auditContext(input: {
  systemPrompt?: string | null;
  historyText?: string | null;
  memoryContext?: string | null;
  interactionContext?: string | null;
  continuityContext?: string | null;
  selfModelBrief?: string | null;
  emotionContext?: string | null;
}): ContextAuditReport {
  const sizes: ContextLayerSizes = {
    systemPromptChars:      input.systemPrompt?.length ?? 0,
    historyChars:           input.historyText?.length ?? 0,
    memoryChars:            input.memoryContext?.length ?? 0,
    interactionSignalChars: input.interactionContext?.length ?? 0,
    continuityChars:        input.continuityContext?.length ?? 0,
    selfModelChars:         input.selfModelBrief?.length ?? 0,
    emotionChars:           input.emotionContext?.length ?? 0,
  };

  const totalChars =
    sizes.systemPromptChars +
    sizes.historyChars +
    sizes.memoryChars +
    sizes.interactionSignalChars +
    sizes.continuityChars +
    sizes.selfModelChars +
    sizes.emotionChars;

  const estimatedTokens = Math.ceil(totalChars / 4);

  const overBudgetLayers: string[] = [];
  if (estimateTokens(input.systemPrompt)      > TOKEN_BUDGET.systemCore)         overBudgetLayers.push("systemCore");
  if (estimateTokens(input.historyText)       > TOKEN_BUDGET.recentMessages)     overBudgetLayers.push("recentMessages");
  if (estimateTokens(input.memoryContext)     > TOKEN_BUDGET.memory)             overBudgetLayers.push("memory");
  if (estimateTokens(input.interactionContext)> TOKEN_BUDGET.interactionSignals) overBudgetLayers.push("interactionSignals");
  if (estimateTokens(input.continuityContext) > TOKEN_BUDGET.continuity)         overBudgetLayers.push("continuity");
  if (estimateTokens(input.selfModelBrief)    > TOKEN_BUDGET.selfModel)          overBudgetLayers.push("selfModel");
  if (estimateTokens(input.emotionContext)    > TOKEN_BUDGET.emotion)            overBudgetLayers.push("emotion");

  return {
    ...sizes,
    totalChars,
    estimatedTokens,
    overBudgetLayers,
    overTotalBudget: estimatedTokens > TOKEN_BUDGET.total,
  };
}

/**
 * Build a flat object suitable for `[HER Context]` log lines. Avoids the
 * caller doing string concatenation and keeps log shape consistent.
 */
export function reportToLog(report: ContextAuditReport): Record<string, unknown> {
  return {
    systemChars:     report.systemPromptChars,
    historyChars:    report.historyChars,
    memoryChars:     report.memoryChars,
    signalChars:     report.interactionSignalChars,
    continuityChars: report.continuityChars,
    selfChars:       report.selfModelChars,
    emotionChars:    report.emotionChars,
    totalChars:      report.totalChars,
    estimatedTokens: report.estimatedTokens,
    overBudget:      report.overBudgetLayers.length ? report.overBudgetLayers : undefined,
    overTotal:       report.overTotalBudget || undefined,
  };
}
