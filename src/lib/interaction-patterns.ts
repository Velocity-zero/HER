/**
 * HER — Interaction Pattern Tracking (Step 21 Part A)
 *
 * Tracks per-user interaction patterns over time:
 *   - Average message length (short/medium/long)
 *   - Response frequency (fast/delayed/sporadic)
 *   - Dominant mode (emotional/casual/task-focused)
 *   - Engagement signals (replies, ignores, drop points)
 *
 * Patterns are stored in Supabase and updated periodically.
 * Used by response mode selection and re-engagement systems.
 */

import type { Message } from "./types";
import { inferUserMode, inferEmotionalTone, type InteractionMode } from "./continuity";
import { getSupabaseClient } from "./supabase-client";

// ── Types ──────────────────────────────────────────────────

export type MessageLength = "short" | "medium" | "long";
export type ResponseFrequency = "fast" | "delayed" | "sporadic";
export type DominantMode = "emotional" | "casual" | "task-focused";

export interface InteractionPattern {
  stylePreference: {
    messageLength: MessageLength;
    usesEmoji: boolean;
    formalityLevel: "casual" | "mixed" | "formal";
  };
  engagementLevel: {
    dominantMode: DominantMode;
    respondsToQuestions: boolean;
    averageConversationLength: number;
    dropOffTurnAvg: number | null;
  };
  responseBehavior: {
    frequency: ResponseFrequency;
    averageGapMs: number;
    ghostsAfterHeavy: boolean;
  };
}

// ── Analysis ───────────────────────────────────────────────

function classifyLength(avgChars: number): MessageLength {
  if (avgChars < 40) return "short";
  if (avgChars < 150) return "medium";
  return "long";
}

function classifyFrequency(avgGapMs: number): ResponseFrequency {
  if (avgGapMs < 30_000) return "fast";       // < 30s
  if (avgGapMs < 300_000) return "delayed";    // < 5min
  return "sporadic";
}

function mapModeToDominant(mode: InteractionMode): DominantMode {
  if (mode === "emotional") return "emotional";
  if (mode === "practical" || mode === "technical") return "task-focused";
  return "casual";
}

/**
 * Analyze a conversation's messages to extract interaction patterns.
 * Pure function — no DB calls, no LLM calls.
 */
export function analyzeInteractionPattern(messages: Message[]): InteractionPattern {
  const userMsgs = messages.filter((m) => m.role === "user" && m.id !== "greeting");
  const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.id !== "greeting");

  // ── Message length ──
  const avgChars = userMsgs.length > 0
    ? userMsgs.reduce((sum, m) => sum + m.content.length, 0) / userMsgs.length
    : 60;

  // ── Emoji usage ──
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}]/u;
  const emojiCount = userMsgs.filter((m) => emojiPattern.test(m.content)).length;
  const usesEmoji = userMsgs.length > 0 ? emojiCount / userMsgs.length > 0.2 : false;

  // ── Formality ──
  const informalSignals = /\b(lol|haha|lmao|omg|nah|ya|yep|nope|gonna|wanna|gotta|tbh|imo|idk|bruh)\b/i;
  const informalCount = userMsgs.filter((m) => informalSignals.test(m.content)).length;
  const informalRatio = userMsgs.length > 0 ? informalCount / userMsgs.length : 0;
  const formalityLevel = informalRatio > 0.4 ? "casual" as const : informalRatio > 0.15 ? "mixed" as const : "formal" as const;

  // ── Dominant mode ──
  const modes = userMsgs.slice(-10).map((m) => mapModeToDominant(inferUserMode(m.content)));
  const modeCount = new Map<DominantMode, number>();
  for (const m of modes) modeCount.set(m, (modeCount.get(m) || 0) + 1);
  const dominantMode = [...modeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "casual";

  // ── Question response detection ──
  let questionsAsked = 0;
  let questionsAnswered = 0;
  for (let i = 0; i < assistantMsgs.length && i < userMsgs.length - 1; i++) {
    if (assistantMsgs[i].content.includes("?")) {
      questionsAsked++;
      const nextUser = userMsgs[i + 1];
      if (nextUser && nextUser.content.length > 5) {
        questionsAnswered++;
      }
    }
  }
  const respondsToQuestions = questionsAsked > 0 ? questionsAnswered / questionsAsked > 0.5 : true;

  // ── Response timing ──
  const gaps: number[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "assistant" && messages[i + 1]?.role === "user") {
      const gap = messages[i + 1].timestamp - messages[i].timestamp;
      if (gap > 0 && gap < 3_600_000) gaps.push(gap); // within 1 hour
    }
  }
  const averageGapMs = gaps.length > 0
    ? gaps.reduce((a, b) => a + b, 0) / gaps.length
    : 60_000;

  // ── Heavy topic ghosting ──
  let ghostsAfterHeavy = false;
  if (messages.length > 4) {
    for (let i = messages.length - 3; i >= 0; i--) {
      if (messages[i].role === "user") {
        const tone = inferEmotionalTone(messages[i].content);
        if (tone === "heavy" || tone === "frustrated") {
          // Check if user dropped off after the next assistant response
          const nextAssistant = messages[i + 1];
          const nextUser = messages[i + 2];
          if (nextAssistant?.role === "assistant" && (!nextUser || nextUser.timestamp - nextAssistant.timestamp > 600_000)) {
            ghostsAfterHeavy = true;
            break;
          }
        }
      }
    }
  }

  return {
    stylePreference: {
      messageLength: classifyLength(avgChars),
      usesEmoji,
      formalityLevel,
    },
    engagementLevel: {
      dominantMode,
      respondsToQuestions,
      averageConversationLength: userMsgs.length,
      dropOffTurnAvg: null, // computed from historical data
    },
    responseBehavior: {
      frequency: classifyFrequency(averageGapMs),
      averageGapMs,
      ghostsAfterHeavy,
    },
  };
}

// ── Persistence ────────────────────────────────────────────

/**
 * Save/update interaction patterns for a user.
 * Uses upsert on user_id.
 */
export async function saveInteractionPattern(
  userId: string,
  pattern: InteractionPattern
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client
      .from("interaction_patterns")
      .upsert({
        user_id: userId,
        patterns: pattern,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
  } catch (err) {
    console.warn("[HER Patterns] Save failed:", err);
  }
}

/**
 * Load stored interaction patterns for a user.
 */
export async function getInteractionPattern(
  userId: string
): Promise<InteractionPattern | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data } = await client
      .from("interaction_patterns")
      .select("patterns")
      .eq("user_id", userId)
      .single();

    return (data?.patterns as InteractionPattern) ?? null;
  } catch {
    return null;
  }
}
