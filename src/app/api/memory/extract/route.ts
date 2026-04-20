/**
 * HER — Memory Extraction API
 *
 * POST /api/memory/extract
 *
 * Called at conversation boundaries (new chat, session switch)
 * to extract and store memorable facts from the conversation.
 *
 * Body: { userId: string, messages: { role: string, content: string }[] }
 * Returns: { extracted: number }
 *
 * Fire-and-forget from the client — never blocks the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractMemories, saveMemoryEntries } from "@/lib/memory";
import { validateApiRequest, checkBodySize } from "@/lib/api-auth";
import { storeMemoryEmbedding } from "@/lib/embeddings";

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ──
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const sizeError = checkBodySize(req);
    if (sizeError) return sizeError;

    const body = await req.json();
    const { userId, messages } = body;

    if (!userId || !messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Missing userId or messages" },
        { status: 400 }
      );
    }

    // Authenticated users can only extract for themselves
    if (auth.userId !== "guest" && auth.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Extract facts from the conversation
    const entries = await extractMemories(messages);

    if (entries.length === 0) {
      return NextResponse.json({ extracted: 0 });
    }

    // Save to Supabase
    await saveMemoryEntries(userId, entries);

    // Generate embeddings for new memories (fire-and-forget, non-blocking)
    // This runs in the background — we don't await all of them
    const { getSupabaseClient } = await import("@/lib/supabase-client");
    const client = getSupabaseClient();
    if (client) {
      // Fetch the most recently inserted memories to get their IDs
      const { data: recent } = await client
        .from("user_memories")
        .select("id, fact")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(entries.length);

      if (recent) {
        // Fire-and-forget embedding generation
        for (const row of recent) {
          storeMemoryEmbedding(row.id, row.fact).catch(() => {});
        }
      }
    }

    return NextResponse.json({ extracted: entries.length });
  } catch (err) {
    console.error("[HER Memory API] Error:", err);
    return NextResponse.json(
      { error: "Memory extraction failed" },
      { status: 500 }
    );
  }
}
