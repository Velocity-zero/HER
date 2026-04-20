/**
 * POST /api/memory/feedback
 *
 * Memory feedback loop — detects corrections, reinforcements,
 * and emotional shifts after each user–assistant exchange.
 *
 * Fire-and-forget from the client. Non-blocking.
 *
 * Body: { userMessage: string, assistantMessage: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/api-auth";
import { getUserMemories } from "@/lib/memory";
import { detectMemoryFeedback, applyMemoryFeedback } from "@/lib/memory-feedback";

export async function POST(req: NextRequest) {
  try {
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    if (auth.userId === "guest") {
      return NextResponse.json({ skipped: true });
    }

    const body = await req.json();
    const { userMessage, assistantMessage } = body;

    if (!userMessage || !assistantMessage) {
      return NextResponse.json({ updated: 0 });
    }

    // Fetch current memories
    const memories = await getUserMemories(auth.userId);
    if (memories.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    // Detect feedback
    const memoryList = memories
      .filter((m) => m.id)
      .slice(0, 20) // Limit to recent 20 for cost
      .map((m) => ({ id: m.id!, fact: m.fact, emotion: m.emotion }));

    const feedbacks = await detectMemoryFeedback(userMessage, assistantMessage, memoryList);

    if (feedbacks.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    // Apply feedback
    await applyMemoryFeedback(feedbacks);

    return NextResponse.json({ updated: feedbacks.length });
  } catch (err) {
    console.error("[HER Memory Feedback API] Error:", err);
    return NextResponse.json({ updated: 0 });
  }
}
