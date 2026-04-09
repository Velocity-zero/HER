/**
 * HER — Memory Retrieval API
 *
 * GET /api/memory?userId=xxx
 *
 * Returns formatted memory context for injection into the system prompt.
 * Called on page load and conversation switch.
 *
 * Returns: { memoryContext: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserMemories, formatMemoryForPrompt } from "@/lib/memory";
import { validateApiRequest } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  try {
    // ── Auth check ──
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const userId = req.nextUrl.searchParams.get("userId");

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

    const memories = await getUserMemories(userId);
    const memoryContext = formatMemoryForPrompt(memories);

    return NextResponse.json({ memoryContext });
  } catch (err) {
    console.error("[HER Memory API] Retrieval error:", err);
    return NextResponse.json({ memoryContext: null });
  }
}
