/**
 * HER — Intelligent Follow-Up System (Step 21 Part E)
 *
 * Extends temporal detection (Step 18) with smarter time inference
 * for vague future statements like:
 *   "I'll do it later"
 *   "after I finish this"
 *   "once I get there"
 *
 * Constraint: max 1 inferred follow-up per conversation thread.
 */

import { nvidiaChat } from "./multimodal";

// ── Types ──────────────────────────────────────────────────

export interface InferredFollowUp {
  shouldSchedule: boolean;
  suggestedDelay: number;       // minutes from now
  summary: string;
  confidence: number;           // 0–1
}

// ── Dedup Guard ────────────────────────────────────────────

/** Track which conversations already have an inferred follow-up */
const inferredConversations = new Set<string>();

export function hasInferredFollowUp(conversationId: string): boolean {
  return inferredConversations.has(conversationId);
}

export function markInferredFollowUp(conversationId: string): void {
  inferredConversations.add(conversationId);
  // Auto-expire after 24h
  setTimeout(() => inferredConversations.delete(conversationId), 24 * 60 * 60 * 1000);
}

// ── Inference ──────────────────────────────────────────────

const FOLLOWUP_PROMPT = `You estimate when a user might be available for a follow-up based on vague statements.

Given the user's message and recent context, determine:
1. Should we schedule a soft follow-up? (true/false)
2. How many minutes from now? (rough estimate)
3. A 5-10 word summary of what to follow up about
4. Your confidence (0.0-1.0)

Return ONLY valid JSON:
{"shouldSchedule": true, "suggestedDelay": 120, "summary": "how their meeting went", "confidence": 0.7}

Rules:
- "later" / "in a bit" → 60-120 minutes
- "after work" / "tonight" → 4-8 hours
- "tomorrow" → 18-24 hours
- "when I get there" → 30-90 minutes
- If no clear future intent → {"shouldSchedule": false, "suggestedDelay": 0, "summary": "", "confidence": 0}
- Be conservative — only schedule if genuinely useful
- Don't schedule for trivial things`;

/**
 * Infer a reasonable follow-up time from vague future statements.
 * Returns null if no follow-up should be scheduled.
 */
export async function inferFollowupTime(
  message: string,
  recentContext: string,
  conversationId: string
): Promise<InferredFollowUp | null> {
  // Max 1 inferred follow-up per conversation
  if (hasInferredFollowUp(conversationId)) return null;

  try {
    const response = await nvidiaChat(
      [
        { role: "system", content: FOLLOWUP_PROMPT },
        {
          role: "user",
          content: `Message: "${message.slice(0, 200)}"\n\nRecent context:\n${recentContext.slice(0, 400)}`,
        },
      ],
      { maxTokens: 100, temperature: 0.2 }
    );

    const parsed = JSON.parse(response.trim());

    if (
      !parsed.shouldSchedule ||
      parsed.confidence < 0.5 ||
      parsed.suggestedDelay < 15 // Don't follow up in under 15 min
    ) {
      return null;
    }

    // Clamp to reasonable range: 15 min to 48 hours
    const delay = Math.max(15, Math.min(2880, parsed.suggestedDelay));

    markInferredFollowUp(conversationId);

    return {
      shouldSchedule: true,
      suggestedDelay: delay,
      summary: parsed.summary || "something they mentioned",
      confidence: parsed.confidence,
    };
  } catch {
    return null;
  }
}
