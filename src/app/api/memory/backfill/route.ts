/**
 * HER — Memory Backfill API
 *
 * POST /api/memory/backfill
 *
 * One-time route that reads ALL existing conversations for a user
 * from Supabase, runs memory extraction on each, and stores the results.
 *
 * Body: { userId: string }
 * Returns: { processed: number, extracted: number, skipped: number }
 *
 * Safe to run multiple times — deduplication is built into saveMemoryEntries().
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase-client";
import { extractMemories, saveMemoryEntries } from "@/lib/memory";
import { validateApiRequest } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ──
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // Authenticated users can only backfill for themselves
    if (auth.userId !== "guest" && auth.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const client = getSupabaseClient();
    if (!client) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // 1. Fetch all conversations for this user
    const { data: conversations, error: convoErr } = await client
      .from("conversations")
      .select("id, title")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (convoErr || !conversations) {
      return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
    }

    console.log(`[HER Backfill] Found ${conversations.length} conversations for user ${userId.slice(0, 8)}...`);

    let totalExtracted = 0;
    let processed = 0;
    let skipped = 0;

    // 2. Process each conversation
    for (const convo of conversations) {
      const { data: messages, error: msgErr } = await client
        .from("messages")
        .select("role, content")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: true });

      if (msgErr || !messages) {
        console.warn(`[HER Backfill] Failed to fetch messages for conversation ${convo.id}`);
        skipped++;
        continue;
      }

      // Skip short conversations (less than 3 user messages)
      const userMsgCount = messages.filter((m: { role: string }) => m.role === "user").length;
      if (userMsgCount < 3) {
        console.log(`[HER Backfill] Skipping "${convo.title}" (only ${userMsgCount} user messages)`);
        skipped++;
        continue;
      }

      console.log(`[HER Backfill] Processing "${convo.title}" (${messages.length} messages)...`);

      try {
        const entries = await extractMemories(
          messages.map((m: { role: string; content: string }) => ({
            role: m.role,
            content: m.content,
          }))
        );

        if (entries.length > 0) {
          await saveMemoryEntries(userId, entries);
          totalExtracted += entries.length;
        }
        processed++;

        // Small delay between conversations to avoid rate limiting
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.warn(`[HER Backfill] Extraction failed for "${convo.title}":`, err);
        skipped++;
      }
    }

    console.log(`[HER Backfill] Done! Processed: ${processed}, Extracted: ${totalExtracted}, Skipped: ${skipped}`);

    return NextResponse.json({
      processed,
      extracted: totalExtracted,
      skipped,
      total: conversations.length,
    });
  } catch (err) {
    console.error("[HER Backfill] Error:", err);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
