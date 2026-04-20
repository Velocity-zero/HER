/**
 * HER — Memory Retrieval API (Step 19 Upgraded)
 *
 * GET /api/memory?userId=xxx&context=current+message
 *
 * Returns ranked, formatted memory context for injection into the system prompt.
 * Uses semantic search (if pgvector available) + dynamic ranking.
 *
 * Returns: { memoryContext: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserMemories, formatMemoryForPrompt } from "@/lib/memory";
import { rankMemories } from "@/lib/memory-ranking";
import { getSemanticMemories } from "@/lib/embeddings";
import { validateApiRequest } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  try {
    // ── Auth check ──
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const userId = req.nextUrl.searchParams.get("userId");
    const context = req.nextUrl.searchParams.get("context") || "";

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    // Authenticated users can only access their own memories
    if (auth.userId !== "guest" && auth.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Fetch all memories
    let memories = await getUserMemories(userId);

    // If we have context, try semantic search to bring relevant memories to the top
    if (context && memories.length > 0) {
      // Attempt semantic recall (non-blocking fallback)
      const semanticHits = await getSemanticMemories(userId, context, 10);
      if (semanticHits.length > 0) {
        // Merge: prioritize semantic hits, then fill from full set
        const semanticIds = new Set(semanticHits.map((h) => h.id));
        const rest = memories.filter((m) => !semanticIds.has(m.id ?? ""));
        // Re-order: semantic hits first (they map back to full MemoryEntry objects)
        const semanticMemories = semanticHits
          .map((h) => memories.find((m) => m.id === h.id))
          .filter(Boolean) as typeof memories;
        memories = [...semanticMemories, ...rest];
      }

      // Rank by relevance, recency, confidence, emotional weight
      const ranked = await rankMemories(context, memories, 8);
      const memoryContext = formatMemoryForPrompt(ranked);
      return NextResponse.json({ memoryContext });
    }

    // No context — just return top 8 by recency (legacy behavior)
    const memoryContext = formatMemoryForPrompt(memories.slice(0, 8));
    return NextResponse.json({ memoryContext });
  } catch (err) {
    console.error("[HER Memory API] Retrieval error:", err);
    return NextResponse.json({ memoryContext: null });
  }
}
