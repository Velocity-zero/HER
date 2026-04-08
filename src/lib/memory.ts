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
  entries: { fact: string; category: MemoryCategory }[]
): Promise<void> {
  const client = getSupabaseClient();
  if (!client || entries.length === 0) return;

  try {
    // Fetch existing memories to avoid duplicates
    const { data: existing } = await client
      .from("user_memories")
      .select("fact")
      .eq("user_id", userId);

    const existingFacts = new Set(
      (existing ?? []).map((e: { fact: string }) => e.fact.toLowerCase().trim())
    );

    // Filter out entries that are too similar to existing ones
    const newEntries = entries.filter(
      (e) => !existingFacts.has(e.fact.toLowerCase().trim())
    );

    if (newEntries.length === 0) {
      console.log("[HER Memory] No new facts to store (all duplicates)");
      return;
    }

    const rows = newEntries.map((e) => ({
      user_id: userId,
      fact: e.fact.trim(),
      category: e.category,
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
      .select("id, user_id, fact, category, created_at, updated_at")
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

Format your response as one fact per line, prefixed with the category:
identity: their name is alex
preference: they love lo-fi music and rainy days
life: they have a corgi named biscuit
context: they have a job interview next week

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

    const entries: { fact: string; category: MemoryCategory }[] = [];

    for (const line of response.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse "category: fact" format
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const cat = trimmed.slice(0, colonIdx).trim().toLowerCase() as MemoryCategory;
      const fact = trimmed.slice(colonIdx + 1).trim();

      if (validCategories.has(cat) && fact.length > 3 && fact.length < 200) {
        entries.push({ fact, category: cat });
      }
    }

    console.log(`[HER Memory] Extracted ${entries.length} facts`);
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
export function formatMemoryForPrompt(memories: MemoryEntry[]): string | null {
  if (memories.length === 0) return null;

  // Deduplicate and take the most recent version of similar facts
  const seen = new Set<string>();
  const unique = memories.filter((m) => {
    const key = m.fact.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Group by category
  const groups: Record<string, string[]> = {};
  for (const m of unique) {
    if (!groups[m.category]) groups[m.category] = [];
    groups[m.category].push(m.fact);
  }

  // Build readable context string
  const parts: string[] = [];

  // Identity first (most important)
  if (groups.identity) {
    parts.push(...groups.identity.map((f) => `- ${f}`));
  }
  if (groups.life) {
    parts.push(...groups.life.map((f) => `- ${f}`));
  }
  if (groups.preference) {
    parts.push(...groups.preference.map((f) => `- ${f}`));
  }
  if (groups.emotional) {
    parts.push(...groups.emotional.map((f) => `- ${f}`));
  }
  if (groups.topic) {
    parts.push(...groups.topic.map((f) => `- ${f}`));
  }
  if (groups.context) {
    parts.push(...groups.context.map((f) => `- ${f} (recent)`));
  }

  return parts.join("\n");
}
