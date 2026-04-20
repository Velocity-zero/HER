/**
 * HER — Semantic Embedding & Recall (Step 19 Part B)
 *
 * Uses NVIDIA NIM embedding API to generate vector embeddings
 * for memory storage and semantic retrieval via pgvector.
 *
 * Falls back gracefully if:
 *   - pgvector extension not enabled in Supabase
 *   - embedding column not yet added
 *   - API fails
 *
 * Flow:
 *   Store: memory text → generateEmbedding() → store alongside fact
 *   Recall: user message → embed → cosine similarity search → top matches
 */

import { getSupabaseClient } from "./supabase-client";

// ── NVIDIA Embedding API ───────────────────────────────────

const EMBEDDING_URL = "https://integrate.api.nvidia.com/v1/embeddings";
const EMBEDDING_MODEL = "nvidia/nv-embedqa-e5-v5";

// Simple in-memory cache to avoid re-embedding the same text
const embeddingCache = new Map<string, number[]>();
const CACHE_MAX = 200;

/**
 * Generate an embedding vector for a text string.
 * Returns null on failure (never throws).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || text.length < 3) return null;

  const cacheKey = text.trim().toLowerCase().slice(0, 500);
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  const apiKey = process.env.NVIDIA_CHAT_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: [text.slice(0, 512)], // Limit input length
        input_type: "query",
        encoding_format: "float",
        truncate: "END",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[HER Embedding] API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const embedding = data?.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      return null;
    }

    // Cache it
    if (embeddingCache.size >= CACHE_MAX) {
      // Evict oldest
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, embedding);

    return embedding;
  } catch (err) {
    console.warn("[HER Embedding] Generation failed:", err);
    return null;
  }
}

// ── Semantic Memory Retrieval ──────────────────────────────

/** Whether pgvector semantic search is available (cached check) */
let pgvectorAvailable: boolean | null = null;

async function checkPgvectorAvailable(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable;

  const client = getSupabaseClient();
  if (!client) {
    pgvectorAvailable = false;
    return false;
  }

  try {
    // Try a simple query that would fail if embedding column doesn't exist
    const { error } = await client
      .from("user_memories")
      .select("id")
      .not("embedding", "is", null)
      .limit(1);

    pgvectorAvailable = !error;
    if (error) {
      console.log("[HER Embedding] pgvector not available — falling back to keyword matching");
    }
  } catch {
    pgvectorAvailable = false;
  }

  return pgvectorAvailable;
}

/**
 * Fetch semantically similar memories using pgvector cosine similarity.
 * Returns memory IDs + facts ordered by similarity.
 * Falls back to empty array if pgvector is not available.
 */
export async function getSemanticMemories(
  userId: string,
  queryText: string,
  limit: number = 10
): Promise<{ id: string; fact: string; category: string; similarity: number }[]> {
  const available = await checkPgvectorAvailable();
  if (!available) return [];

  const queryEmbedding = await generateEmbedding(queryText);
  if (!queryEmbedding) return [];

  const client = getSupabaseClient();
  if (!client) return [];

  try {
    // Use Supabase RPC for vector similarity search
    const { data, error } = await client.rpc("match_memories", {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_count: limit,
    });

    if (error) {
      // If RPC doesn't exist, mark pgvector as unavailable
      if (error.message.includes("function") || error.message.includes("does not exist")) {
        pgvectorAvailable = false;
        console.log("[HER Embedding] match_memories RPC not found — disabling semantic search");
      }
      return [];
    }

    return (data ?? []).map((row: { id: string; fact: string; category: string; similarity: number }) => ({
      id: row.id,
      fact: row.fact,
      category: row.category,
      similarity: row.similarity,
    }));
  } catch (err) {
    console.warn("[HER Embedding] Semantic search failed:", err);
    return [];
  }
}

/**
 * Store an embedding for an existing memory entry.
 * Called after memory extraction — non-blocking.
 */
export async function storeMemoryEmbedding(
  memoryId: string,
  fact: string
): Promise<void> {
  const available = await checkPgvectorAvailable();
  if (!available) return;

  const embedding = await generateEmbedding(fact);
  if (!embedding) return;

  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client
      .from("user_memories")
      .update({ embedding: JSON.stringify(embedding) })
      .eq("id", memoryId);
  } catch (err) {
    console.warn("[HER Embedding] Store failed:", err);
  }
}

/**
 * Batch generate and store embeddings for memories that don't have one.
 * Called periodically or during backfill.
 */
export async function backfillEmbeddings(userId: string, batchSize: number = 20): Promise<number> {
  const available = await checkPgvectorAvailable();
  if (!available) return 0;

  const client = getSupabaseClient();
  if (!client) return 0;

  try {
    const { data } = await client
      .from("user_memories")
      .select("id, fact")
      .eq("user_id", userId)
      .is("embedding", null)
      .limit(batchSize);

    if (!data || data.length === 0) return 0;

    let count = 0;
    for (const row of data) {
      await storeMemoryEmbedding(row.id, row.fact);
      count++;
    }

    console.log(`[HER Embedding] Backfilled ${count} embeddings for user ${userId}`);
    return count;
  } catch (err) {
    console.warn("[HER Embedding] Backfill failed:", err);
    return 0;
  }
}
