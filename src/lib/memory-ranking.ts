/**
 * HER — Memory Ranking & Decay System (Step 19 Parts A + D)
 *
 * Scores memories dynamically so only the most relevant, recent,
 * and emotionally significant facts surface in conversation.
 *
 * Score formula:
 *   score = relevance*0.4 + recency*0.2 + confidence*0.2 + emotional_weight*0.2
 *
 * Decay: score *= decayFactor (decreases over time unless reinforced)
 * Reinforcement: if topic reappears, memory gets boosted.
 */

import type { MemoryCategory } from "./memory";
import { nvidiaChat } from "./multimodal";

// ── Types ──────────────────────────────────────────────────

export interface RankedMemory {
  id?: string;
  user_id: string;
  fact: string;
  category: MemoryCategory;
  created_at?: string;
  updated_at?: string;
  confidence?: number;
  emotion?: string | null;
  intensity?: number | null;
  /** Computed score (0–1) */
  score: number;
}

export interface MemoryWithMeta {
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

// ── Scoring Helpers ────────────────────────────────────────

/** Recency score: 1.0 for today, decays to 0 over ~90 days */
function recencyScore(updatedAt?: string): number {
  if (!updatedAt) return 0.3;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: half-life ~30 days
  return Math.exp(-ageDays / 45);
}

/** Emotional weight score from emotion + intensity */
function emotionalWeightScore(emotion?: string | null, intensity?: number | null): number {
  if (!emotion || emotion === "neutral") return 0.2;
  const base = intensity ?? 0.5;
  // High-impact emotions get a boost
  const boost = ["anxious", "stressed", "excited", "sad", "angry", "hurt"].includes(emotion) ? 0.2 : 0;
  return Math.min(1.0, base + boost);
}

/** Decay factor: decreases over time, floor at 0.1 */
function decayFactor(updatedAt?: string): number {
  if (!updatedAt) return 0.5;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Half-life ~60 days, floor 0.1
  return Math.max(0.1, Math.exp(-ageDays / 90));
}

// ── Relevance Scoring (LLM-based, batched) ─────────────────

/**
 * Ask the LLM to score relevance of memories to the current context.
 * Returns a map of memory index → relevance score (0–1).
 * Falls back to keyword overlap if LLM fails.
 */
async function scoreRelevance(
  currentContext: string,
  facts: string[]
): Promise<number[]> {
  if (facts.length === 0) return [];

  // Fallback: keyword overlap scoring
  const fallback = (): number[] => {
    const contextWords = new Set(currentContext.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    return facts.map((fact) => {
      const factWords = fact.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (factWords.length === 0) return 0.3;
      let overlap = 0;
      for (const w of factWords) if (contextWords.has(w)) overlap++;
      return Math.min(1.0, 0.2 + (overlap / factWords.length) * 0.8);
    });
  };

  try {
    const numbered = facts.map((f, i) => `${i}: ${f}`).join("\n");
    const response = await nvidiaChat(
      [
        {
          role: "system",
          content: `You are a relevance scorer. Given a conversation context and a list of memory facts, score each fact's relevance to the current context from 0.0 to 1.0.

Return ONLY a comma-separated list of scores, one per fact, in order. Example: 0.8,0.3,0.9,0.1

Rules:
- 1.0 = directly relevant to what they're talking about right now
- 0.5 = tangentially related or useful background
- 0.1 = completely unrelated right now
- Be selective — not everything is relevant`,
        },
        {
          role: "user",
          content: `Current context:\n"${currentContext.slice(0, 500)}"\n\nMemory facts:\n${numbered}\n\nScores:`,
        },
      ],
      { maxTokens: 100, temperature: 0.1 }
    );

    const scores = response
      .trim()
      .split(/[,\s]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n));

    // Validate we got the right count
    if (scores.length === facts.length) {
      return scores.map((s) => Math.max(0, Math.min(1, s)));
    }

    return fallback();
  } catch {
    return fallback();
  }
}

// ── Main Ranking Function ──────────────────────────────────

/**
 * Rank memories by dynamic scoring: relevance, recency, confidence,
 * emotional weight — with decay applied.
 *
 * Returns the top `limit` memories, sorted by score descending.
 */
export async function rankMemories(
  currentContext: string,
  memories: MemoryWithMeta[],
  limit: number = 8
): Promise<RankedMemory[]> {
  if (memories.length === 0) return [];

  // If few enough memories, skip LLM relevance scoring
  const facts = memories.map((m) => m.fact);
  const relevanceScores = memories.length > 3
    ? await scoreRelevance(currentContext, facts)
    : facts.map(() => 0.6); // Default mid-relevance for small sets

  const ranked: RankedMemory[] = memories.map((m, i) => {
    const relevance = relevanceScores[i] ?? 0.5;
    const recency = recencyScore(m.updated_at);
    const confidence = m.confidence ?? 0.8;
    const emotionalWeight = emotionalWeightScore(m.emotion, m.intensity);
    const decay = decayFactor(m.updated_at);

    const rawScore =
      relevance * 0.4 +
      recency * 0.2 +
      confidence * 0.2 +
      emotionalWeight * 0.2;

    const score = rawScore * decay;

    return { ...m, score };
  });

  // Sort by score descending, take top N
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

// ── Reinforcement ──────────────────────────────────────────

/**
 * Reinforce a memory by bumping its updated_at timestamp.
 * Called when a user mentions a topic that matches an existing memory.
 */
export async function reinforceMemory(memoryId: string): Promise<void> {
  const { getSupabaseClient } = await import("./supabase-client");
  const client = getSupabaseClient();
  if (!client || !memoryId) return;

  try {
    await client
      .from("user_memories")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", memoryId);
  } catch (err) {
    console.warn("[HER Memory Ranking] Reinforce failed:", err);
  }
}
