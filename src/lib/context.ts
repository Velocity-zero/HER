/**
 * HER — Context Builder
 *
 * Manages the context window sent to the model.
 * Instead of sending the entire conversation forever,
 * this builds a smart rolling window that keeps:
 *
 *   1. The system prompt (always)
 *   2. A conversation summary (when available — future)
 *   3. The most recent N messages (rolling window)
 *
 * This keeps costs down, avoids context overflow,
 * and preserves emotional continuity.
 *
 * Architecture:
 *   Full message history → buildContext() → ModelMessage[]
 *   (system prompt + optional summary + recent messages)
 */

import { Message, ModelMessage, ConversationMode } from "./types";
import { buildSystemPrompt } from "./prompts/index";

// ── Configuration ──────────────────────────────────────────

/**
 * Context window settings.
 * Tune these to balance quality vs. token cost.
 *
 * Step 18.3 (Phase C): recentMessageCount tightened from 40 → 30. Older
 * messages now flow through buildConversationSummary() instead of being
 * sent verbatim, which keeps token cost bounded on long-lived accounts.
 */
export const CONTEXT_CONFIG = {
  /** Max recent messages to include in the rolling window */
  recentMessageCount: 30,

  /** Min messages to always keep (even in aggressive trimming) */
  minMessages: 6,

  /**
   * Rough char budget for the conversation portion.
   * Not a hard limit — just a guideline for future smart trimming.
   * (System prompt chars are separate.)
   */
  softCharBudget: 12_000,
} as const;

// ── Summary Builder ────────────────────────────────────────

/**
 * Deterministic, no-LLM heuristic summary of older messages.
 *
 * Why heuristic instead of an LLM call:
 *   - An LLM-driven summary adds 500–1500ms of latency to every chat
 *     request on long-lived accounts. That's exactly the production
 *     pain we're trying to eliminate.
 *   - A bounded heuristic gives the model the *shape* of what happened
 *     (turn count, who carried the conversation, a peek at the first
 *     and most recent older turn) without re-summarizing semantics that
 *     the memory + interaction-signal pipelines already capture.
 *
 * Output is intentionally compact (~250–500 chars). When `olderMessages`
 * is small we return null — no summary needed.
 */
export function buildConversationSummary(
  olderMessages: Message[]
): string | null {
  if (olderMessages.length < 4) return null;

  const userTurns = olderMessages.filter((m) => m.role === "user").length;
  const herTurns = olderMessages.filter((m) => m.role === "assistant").length;

  // Anchor turns the model can latch onto: the first thing that started
  // the older window, and the most recent thing that fell out of it.
  const firstUserTurn = olderMessages.find((m) => m.role === "user");
  const lastTurn = olderMessages[olderMessages.length - 1];

  const trim = (s: string, max = 140): string => {
    const flat = s.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
  };

  const lines: string[] = [
    `${olderMessages.length} earlier turns (${userTurns} from them, ${herTurns} from you).`,
  ];
  if (firstUserTurn) {
    lines.push(`it started with them saying: "${trim(firstUserTurn.content)}"`);
  }
  if (lastTurn && lastTurn !== firstUserTurn) {
    const who = lastTurn.role === "user" ? "they" : "you";
    lines.push(`most recently ${who} said: "${trim(lastTurn.content)}"`);
  }
  lines.push("the live messages below pick up from there.");
  return lines.join(" ");
}

// ── Context Builder ────────────────────────────────────────

export interface ContextOptions {
  mode?: ConversationMode;
  /** Override the rolling window size */
  recentCount?: number;
  /** Externally provided memory context */
  memoryContext?: string;
  /** Compact continuity context for anti-repetition */
  continuityContext?: string;
  /** Rapport level (0–4) for progressive bonding */
  rapportLevel?: number;
  /** Response mode instruction from adaptive intelligence (Step 21) */
  responseModeInstruction?: string;
  /** Anti-repetition variation instruction (Step 21 Part C) */
  antiRepetitionInstruction?: string;
  /** IANA timezone name from the user's browser */
  userTimezone?: string;
}

/**
 * Builds the full model context from a conversation history.
 *
 * Returns a clean ModelMessage[] array:
 *   [system prompt, ...recent conversation messages]
 *
 * The system prompt includes all personality layers,
 * any available memory/summary context, and the mode overlay.
 *
 * This is the ONLY function the API route / conversation builder
 * should call to prepare messages for the provider.
 */
export function buildContext(
  messages: Message[],
  options: ContextOptions = {}
): ModelMessage[] {
  const recentCount = options.recentCount ?? CONTEXT_CONFIG.recentMessageCount;

  // Split messages into "older" (summarizable) and "recent" (kept verbatim)
  const splitIndex = Math.max(0, messages.length - recentCount);
  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // Build summary of older messages (future — returns null for now)
  const summary = olderMessages.length > 0
    ? buildConversationSummary(olderMessages)
    : null;

  // Build memory context (supplied externally by the client via /api/memory)
  const memory = options.memoryContext ?? null;

  // Assemble system prompt with all layers
  const systemContent = buildSystemPrompt({
    mode: options.mode,
    rapportLevel: (options.rapportLevel ?? 0) as import("./rapport").RapportLevel,
    conversationSummary: summary ?? undefined,
    memoryContext: memory ?? undefined,
    userTimezone: options.userTimezone,
    continuityContext: [
      options.continuityContext,
      options.responseModeInstruction,
      options.antiRepetitionInstruction,
    ].filter(Boolean).join("\n") || undefined,
  });

  const systemMessage: ModelMessage = {
    role: "system",
    content: systemContent,
  };

  // Convert recent messages to ModelMessage format
  const conversationMessages: ModelMessage[] = recentMessages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  return [systemMessage, ...conversationMessages];
}
