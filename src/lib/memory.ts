/**
 * HER — Cross-Conversation Memory System
 *
 * Extracts and stores meaningful facts, preferences, and context
 * from conversations so HER remembers across sessions.
 *
 * Architecture:
 *   End of conversation → extractMemories() → Mistral extracts facts
 *   → saveMemoryEntries() → Supabase `user_memories` table
 *
 *   New conversation → getUserMemories() → buildMemoryContext()
 *   → injected into system prompt as "THINGS YOU REMEMBER"
 *
 * Memory entries are compact strings like:
 *   "their name is Alex"
 *   "they love rainy days and lo-fi music"
 *   "they were stressed about a job interview last time"
 *   "they have a dog named Biscuit"
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";
import { nvidiaChat } from "./multimodal";

// ── Types ──────────────────────────────────────────────────

export interface MemoryEntry {
  id?: string;
  user_id: string;
  fact: string;
  category: MemoryCategory;
  created_at?: string;
  updated_at?: string;
  confidence?: number;
  emotion?: string | null;
  intensity?: number | null;
}

export type MemoryCategory =
  | "identity"      // name, age, location, pronouns
  | "preference"    // likes, dislikes, taste
  | "life"          // job, relationships, pets, hobbies
  | "emotional"     // mood patterns, what stresses/excites them
  | "topic"         // things they've talked about / care about
  | "context";      // recent situational stuff (job interview, trip, etc.)

// ── Memory Persistence ─────────────────────────────────────

/**
 * Save extracted memory entries to Supabase.
 * Uses upsert-like behavior: checks for duplicates before inserting.
 */
export async function saveMemoryEntries(
  userId: string,
  entries: { fact: string; category: MemoryCategory; confidence?: number }[]
): Promise<void> {
  const client = getSupabaseClient();
  if (!client || entries.length === 0) return;

  try {
    // Fetch existing memories to avoid duplicates
    const { data: existing } = await client
      .from("user_memories")
      .select("id, fact")
      .eq("user_id", userId);

    const existingEntries = (existing ?? []) as { id: string; fact: string }[];

    // Smart dedup: check for semantic similarity (word overlap), not just exact match
    const newEntries = entries.filter((e) => {
      const eLower = e.fact.toLowerCase().trim();
      return !existingEntries.some((ex) => {
        const exLower = ex.fact.toLowerCase().trim();
        // Exact match
        if (exLower === eLower) return true;
        // High word overlap (>70% shared words = likely duplicate)
        const eWords = new Set(eLower.split(/\s+/));
        const exWords = new Set(exLower.split(/\s+/));
        let overlap = 0;
        for (const w of eWords) { if (exWords.has(w)) overlap++; }
        const similarity = overlap / Math.max(eWords.size, exWords.size);
        return similarity > 0.7;
      });
    });

    if (newEntries.length === 0) {
      console.log("[HER Memory] No new facts to store (all duplicates)");
      return;
    }

    const rows = newEntries.map((e) => ({
      user_id: userId,
      fact: e.fact.trim(),
      category: e.category,
      confidence: e.confidence ?? 0.8,
      emotion: (e as { emotion?: string }).emotion ?? "neutral",
      intensity: (e as { intensity?: number }).intensity ?? 0.2,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await client.from("user_memories").insert(rows);

    if (error) {
      console.warn("[HER Memory] Save failed:", error.message);
    } else {
      console.log(`[HER Memory] Saved ${rows.length} new memories`);
    }
  } catch (err) {
    console.warn("[HER Memory] Save exception:", err);
  }
}

/**
 * Fetch all memory entries for a user, newest first.
 * Returns an empty array on failure (safe default).
 */
export async function getUserMemories(
  userId: string
): Promise<MemoryEntry[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from("user_memories")
      .select("id, user_id, fact, category, created_at, updated_at, confidence, emotion, intensity")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50); // Cap to keep context window reasonable

    if (error) {
      console.warn("[HER Memory] Fetch failed:", error.message);
      return [];
    }

    return (data ?? []) as MemoryEntry[];
  } catch (err) {
    console.warn("[HER Memory] Fetch exception:", err);
    return [];
  }
}

/**
 * Delete a specific memory entry (e.g. if user asks to forget something).
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from("user_memories")
      .delete()
      .eq("id", memoryId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Update an existing memory's fact text and bump its timestamp.
 * Used when Mistral refines/updates an existing fact.
 */
export async function updateMemoryFact(
  memoryId: string,
  newFact: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from("user_memories")
      .update({ fact: newFact.trim(), updated_at: new Date().toISOString() })
      .eq("id", memoryId);

    return !error;
  } catch {
    return false;
  }
}

// ── Memory Extraction (via Mistral) ────────────────────────

const EXTRACTION_PROMPT = `You are a memory extraction system. Your job is to read a conversation and extract important facts about the USER (not the assistant).

Extract ONLY things worth remembering for future conversations. Be selective — quality over quantity.

Categories:
- identity: name, age, location, pronouns, occupation
- preference: likes, dislikes, favorites, taste in music/movies/food/etc
- life: job details, relationships, pets, hobbies, daily routine
- emotional: recurring moods, what stresses them, what makes them happy
- topic: subjects they care deeply about, recurring interests
- context: current life situations (upcoming events, recent changes, ongoing problems)

Rules:
- Write each fact as a short, clear sentence in lowercase
- Write from the perspective of someone remembering: "their name is alex" not "the user's name is alex"
- Only extract facts the user explicitly shared or clearly implied
- Do NOT extract facts about the assistant
- Do NOT extract generic conversation filler
- Do NOT repeat or rephrase the same fact
- If there's nothing meaningful to extract, return NONE
- Rate each fact's confidence from 0.0 to 1.0 (how certain are you this is a real fact, not a joke or hypothetical?)

Format your response as one fact per line, prefixed with category, confidence, emotion, and intensity:
identity|0.95|neutral|0.1: their name is alex
preference|0.8|happy|0.4: they love lo-fi music and rainy days
life|0.9|neutral|0.2: they have a corgi named biscuit
context|0.7|anxious|0.7: they have a job interview next week

Emotion values: neutral, happy, excited, anxious, stressed, sad, angry, hurt, hopeful, nostalgic, frustrated, relieved
Intensity: 0.0 (barely felt) to 1.0 (very strong)

If nothing worth remembering: just write NONE`;

/**
 * Extract memorable facts from a conversation using Mistral.
 * Returns parsed entries ready for storage.
 */
export async function extractMemories(
  messages: { role: string; content: string }[]
): Promise<{ fact: string; category: MemoryCategory }[]> {
  // Only process conversations with enough substance
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length < 3) {
    console.log("[HER Memory] Conversation too short for extraction (<3 user messages)");
    return [];
  }

  // Build a compact transcript (skip system messages, limit length)
  const transcript = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "user" : "her"}: ${m.content}`)
    .join("\n")
    .slice(-6000); // Last ~6000 chars to stay within context

  try {
    const response = await nvidiaChat(
      [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: `Here is the conversation:\n\n${transcript}\n\nExtract memorable facts about the user:` },
      ],
      { maxTokens: 400, temperature: 0.3, topP: 0.9 }
    );

    // Parse response
    if (response.trim().toUpperCase() === "NONE") {
      console.log("[HER Memory] Nothing worth remembering from this conversation");
      return [];
    }

    const validCategories = new Set<MemoryCategory>([
      "identity", "preference", "life", "emotional", "topic", "context",
    ]);

    const entries: { fact: string; category: MemoryCategory; confidence: number; emotion: string; intensity: number }[] = [];

    for (const line of response.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse "category|confidence|emotion|intensity: fact" or legacy formats
      let cat: string;
      let fact: string;
      let confidence = 0.8;
      let emotion = "neutral";
      let intensity = 0.2;

      // Full format: category|0.95|anxious|0.7: fact
      const fullMatch = trimmed.match(/^(\w+)\|(\d*\.?\d+)\|(\w+)\|(\d*\.?\d+):\s*(.+)/);
      if (fullMatch) {
        cat = fullMatch[1].toLowerCase();
        confidence = parseFloat(fullMatch[2]);
        emotion = fullMatch[3].toLowerCase();
        intensity = parseFloat(fullMatch[4]);
        fact = fullMatch[5].trim();
      } else {
        // Legacy: category|confidence: fact
        const pipeMatch = trimmed.match(/^(\w+)\|(\d*\.?\d+):\s*(.+)/);
        if (pipeMatch) {
          cat = pipeMatch[1].toLowerCase();
          confidence = parseFloat(pipeMatch[2]);
          fact = pipeMatch[3].trim();
        } else {
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx === -1) continue;
          cat = trimmed.slice(0, colonIdx).trim().toLowerCase();
          fact = trimmed.slice(colonIdx + 1).trim();
        }
      }

      // Filter by confidence threshold
      if (confidence < 0.6) continue;

      if (validCategories.has(cat as MemoryCategory) && fact.length > 3 && fact.length < 200) {
        entries.push({ fact, category: cat as MemoryCategory, confidence, emotion, intensity });
      }
    }

    console.log(`[HER Memory] Extracted ${entries.length} facts (confidence > 0.6)`);
    return entries;
  } catch (err) {
    console.warn("[HER Memory] Extraction failed:", err);
    return [];
  }
}

// ── Memory Context Builder ─────────────────────────────────

/**
 * Format memory entries into a context string for the system prompt.
 * Groups by category for readability.
 */
/**
 * Format memory entries into a natural context string for the system prompt.
 * Rules (Part E): no timestamps, no technical labels, no repetition, max 8 items.
 * Emotional memories get subtle tone hints.
 */
export function formatMemoryForPrompt(memories: MemoryEntry[]): string | null {
  if (memories.length === 0) return null;

  // Deduplicate
  const seen = new Set<string>();
  const unique = memories.filter((m) => {
    const key = m.fact.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Take top 8 (already ranked if coming from rankMemories)
  const top = unique.slice(0, 8);

  // Build natural lines — no category labels, no timestamps
  const lines = top.map((m) => {
    let line = `- ${m.fact}`;
    // Subtle emotional hint for high-intensity memories
    if (m.emotion && m.emotion !== "neutral" && m.intensity && m.intensity >= 0.6) {
      const emotionHints: Record<string, string> = {
        anxious: "(this seemed to worry them)",
        stressed: "(this was weighing on them)",
        excited: "(they were really excited about this)",
        sad: "(this was a sensitive topic)",
        happy: "(this made them happy)",
        hurt: "(this was painful for them)",
        hopeful: "(they were hopeful about this)",
        frustrated: "(this frustrated them)",
      };
      const hint = emotionHints[m.emotion];
      if (hint) line += " " + hint;
    }
    return line;
  });

  return lines.join("\n");
}
