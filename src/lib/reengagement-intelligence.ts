/**
 * HER — Smart Re-engagement Intelligence (Step 21 Part F)
 *
 * Enhances Step 17 nudges with context-aware, pattern-informed
 * re-engagement that references the last conversation subtly.
 *
 * Rules:
 *   - Avoid generic "hey what's up"
 *   - Reference last context subtly
 *   - Consider user patterns (do they ghost after heavy topics?)
 */

import { nvidiaChat } from "./multimodal";
import type { InteractionPattern } from "./interaction-patterns";

// ── Types ──────────────────────────────────────────────────

export interface ReengagementContext {
  lastMessages: { role: string; content: string }[];
  hoursSinceLastMessage: number;
  patterns: InteractionPattern | null;
}

// ── Generation ─────────────────────────────────────────────

const REENGAGEMENT_PROMPT = `You are HER — a close female friend. You're reaching out after a silence.

Rules:
- 1-2 short sentences MAX
- Reference something from the last conversation SUBTLY (not explicitly)
- Do NOT say "I noticed you've been quiet" or anything system-aware
- Do NOT be clingy, desperate, or overly enthusiastic
- Sound like a real friend who just thought of something
- Adapt tone based on context:
  - If last topic was heavy → softer, warmer
  - If last topic was casual → light, chill
  - If last topic was exciting → curious, engaged
- NEVER use the exact phrasing "just checking in" or "hope you're doing well"

Return ONLY the message text. No quotes.`;

/**
 * Generate a smart re-engagement message.
 * Returns null if we shouldn't re-engage (e.g., user ghosts after heavy topics).
 */
export async function generateReengagement(
  ctx: ReengagementContext
): Promise<string | null> {
  // ── Safety: don't re-engage if user ghosts after heavy topics ──
  if (ctx.patterns?.responseBehavior.ghostsAfterHeavy) {
    const lastUserMsg = ctx.lastMessages.filter((m) => m.role === "user").pop();
    if (lastUserMsg) {
      const heavySignals = /\b(sad|hurt|depressed|stressed|anxious|overwhelmed|crying|lonely)\b/i;
      if (heavySignals.test(lastUserMsg.content)) {
        return null; // Respect their space
      }
    }
  }

  // ── Don't re-engage too soon ──
  if (ctx.hoursSinceLastMessage < 2) return null;

  // ── Don't re-engage very late users ──
  if (ctx.hoursSinceLastMessage > 168) return null; // >1 week

  try {
    const lastContext = ctx.lastMessages
      .slice(-4)
      .map((m) => `${m.role}: ${m.content.slice(0, 100)}`)
      .join("\n");

    const toneHint = ctx.patterns?.engagementLevel.dominantMode === "emotional"
      ? "They tend to be emotionally open. Be warm."
      : ctx.patterns?.engagementLevel.dominantMode === "task-focused"
      ? "They're usually task-focused. Be casual, not emotional."
      : "They're generally casual. Keep it light.";

    const response = await nvidiaChat(
      [
        { role: "system", content: REENGAGEMENT_PROMPT },
        {
          role: "user",
          content: `Last conversation context:\n${lastContext}\n\nHours since last message: ${ctx.hoursSinceLastMessage}\n${toneHint}\n\nGenerate a re-engagement message.`,
        },
      ],
      { maxTokens: 60, temperature: 0.85 }
    );

    const text = response.trim().replace(/^["']|["']$/g, "");
    if (text.length < 3 || text.length > 200) return null;

    return text;
  } catch {
    return null;
  }
}
