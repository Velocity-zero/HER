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
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    // Validate: if user is authenticated, they can only access their own memories
    const authUser = await getCurrentUser();
    if (authUser && authUser.id !== userId) {
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
