/**
 * HER — Memory Feedback Loop (Step 19 Part G)
 *
 * After the user responds, the LLM detects whether any memories
 * should be updated, corrected, reinforced, or have emotions adjusted.
 *
 * This allows:
 *   - Correcting wrong assumptions
 *   - Strengthening accurate memories
 *   - Evolving personality understanding over time
 */

import { nvidiaChat } from "./multimodal";
import { reinforceMemory } from "./memory-ranking";
import { getSupabaseClient } from "./supabase-client";
import { debug } from "@/lib/debug";

// ── Types ──────────────────────────────────────────────────

interface MemoryFeedback {
  memoryId: string;
  action: "reinforce" | "correct" | "adjust_emotion" | "remove";
  newFact?: string;
  newEmotion?: string;
  newIntensity?: number;
}

// ── Feedback Detection ─────────────────────────────────────

const FEEDBACK_PROMPT = `You are a memory correction system. Given a user's message, the assistant's response, and a list of stored memories about the user, detect if any memories need updating.

For each memory that needs action, output a JSON line:
{"index": 0, "action": "reinforce"}
{"index": 2, "action": "correct", "newFact": "corrected fact text"}
{"index": 1, "action": "adjust_emotion", "emotion": "relieved", "intensity": 0.3}
{"index": 3, "action": "remove"}

Actions:
- reinforce: user confirmed or mentioned this topic again → bump priority
- correct: user corrected a wrong assumption → provide updated fact
- adjust_emotion: emotional state around this topic changed → new emotion + intensity
- remove: memory is clearly wrong or user asked to forget it

Rules:
- Only output actions for memories that ACTUALLY need updating
- Most of the time, output NONE (nothing to update)
- Be conservative — don't over-correct
- If user says something contradicting a memory, correct it
- If user revisits a topic naturally, reinforce it

Output NONE if no updates needed. Otherwise output one JSON per line.`;

/**
 * Detect memory feedback from a user–assistant exchange.
 * Returns a list of actions to apply to existing memories.
 * Non-blocking, fire-and-forget.
 */
export async function detectMemoryFeedback(
  userMessage: string,
  assistantMessage: string,
  memories: { id: string; fact: string; emotion?: string | null }[]
): Promise<MemoryFeedback[]> {
  if (memories.length === 0) return [];

  const memoryList = memories
    .map((m, i) => `${i}: "${m.fact}"${m.emotion && m.emotion !== "neutral" ? ` (${m.emotion})` : ""}`)
    .join("\n");

  try {
    const response = await nvidiaChat(
      [
        { role: "system", content: FEEDBACK_PROMPT },
        {
          role: "user",
          content: `User said: "${userMessage.slice(0, 300)}"\nAssistant replied: "${assistantMessage.slice(0, 300)}"\n\nStored memories:\n${memoryList}\n\nFeedback:`,
        },
      ],
      { maxTokens: 200, temperature: 0.2 }
    );

    if (response.trim().toUpperCase() === "NONE") return [];

    const feedbacks: MemoryFeedback[] = [];

    for (const line of response.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "NONE") continue;

      try {
        const parsed = JSON.parse(trimmed);
        const idx = parsed.index;
        if (typeof idx !== "number" || idx < 0 || idx >= memories.length) continue;

        const memory = memories[idx];
        feedbacks.push({
          memoryId: memory.id,
          action: parsed.action,
          newFact: parsed.newFact,
          newEmotion: parsed.emotion,
          newIntensity: parsed.intensity,
        });
      } catch {
        // Skip malformed JSON lines
      }
    }

    return feedbacks;
  } catch (err) {
    console.warn("[HER Memory Feedback] Detection failed:", err);
    return [];
  }
}

/**
 * Apply detected memory feedback actions.
 * Called fire-and-forget after assistant responds.
 */
export async function applyMemoryFeedback(feedbacks: MemoryFeedback[]): Promise<void> {
  if (feedbacks.length === 0) return;

  const client = getSupabaseClient();
  if (!client) return;

  for (const fb of feedbacks) {
    try {
      switch (fb.action) {
        case "reinforce":
          await reinforceMemory(fb.memoryId);
          debug(`[HER Memory Feedback] Reinforced: ${fb.memoryId}`);
          break;

        case "correct":
          if (fb.newFact) {
            await client
              .from("user_memories")
              .update({
                fact: fb.newFact.trim(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", fb.memoryId);
            debug(`[HER Memory Feedback] Corrected: ${fb.memoryId}`);
          }
          break;

        case "adjust_emotion":
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (fb.newEmotion) updates.emotion = fb.newEmotion;
          if (fb.newIntensity !== undefined) updates.intensity = fb.newIntensity;
          await client
            .from("user_memories")
            .update(updates)
            .eq("id", fb.memoryId);
          debug(`[HER Memory Feedback] Adjusted emotion: ${fb.memoryId} → ${fb.newEmotion}`);
          break;

        case "remove":
          await client
            .from("user_memories")
            .delete()
            .eq("id", fb.memoryId);
          debug(`[HER Memory Feedback] Removed: ${fb.memoryId}`);
          break;
      }
    } catch (err) {
      console.warn(`[HER Memory Feedback] Failed to apply ${fb.action} on ${fb.memoryId}:`, err);
    }
  }
}
