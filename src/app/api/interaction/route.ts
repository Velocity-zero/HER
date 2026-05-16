/**
 * HER — Interaction Signal Retrieval API (Step EXP+1)
 *
 * GET /api/interaction?userId=xxx&conversationId=optional&limit=optional
 *
 * Returns a compact, behavioral-only context block for injection into the
 * system prompt. Empty/null when there is nothing useful to say.
 *
 * Returns: { interactionContext: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/api-auth";
import {
  getRecentInteractionSignals,
  formatSignalsForPrompt,
  type StoredInteractionSignal,
} from "@/lib/interaction-signals";
import { loadSelfState, type LoadedSelfState } from "@/lib/self-state-store";
import {
  decaySyntheticSelfState,
  buildSelfStateBrief,
  NEUTRAL_STATE,
} from "@/lib/self-model";
import { withTimeout } from "@/lib/with-timeout";

export async function GET(req: NextRequest) {
  try {
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const userId = req.nextUrl.searchParams.get("userId");
    const conversationId = req.nextUrl.searchParams.get("conversationId");
    const limitParam = req.nextUrl.searchParams.get("limit");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    if (auth.userId !== "guest" && auth.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const limit = limitParam ? Math.max(1, Math.min(20, parseInt(limitParam, 10) || 6)) : 6;

    // ── Step 18.3 (Phase C): bounded DB reads ──
    // On engaged accounts both signals + self-state fetches occasionally
    // stall under Supabase load. We never let them block the chat
    // pipeline — withTimeout returns a safe empty value and logs which
    // subsystem stalled so we can spot it in traces.
    const signals = await withTimeout<StoredInteractionSignal[]>(
      getRecentInteractionSignals({
        userId,
        conversationId: conversationId || null,
        limit,
      }),
      { label: "interaction-signals.get", ms: 1200, fallback: [] },
    );

    const signalsBlock = formatSignalsForPrompt(signals);

    // ── Step 18.X: append HER's synthetic self-state brief ──
    // Read → apply read-time decay → derive brief. The brief is null when
    // nothing distinctive is going on, so we never inject filler.
    let selfBlock: string | null = null;
    try {
      const selfResult = await withTimeout<LoadedSelfState>(
        loadSelfState(userId),
        {
          label: "self-state.load",
          ms: 1200,
          fallback: { state: { ...NEUTRAL_STATE }, lastUpdated: null },
        },
      );
      const decayed = selfResult.lastUpdated
        ? decaySyntheticSelfState(selfResult.state, selfResult.lastUpdated)
        : selfResult.state;
      selfBlock = buildSelfStateBrief(decayed);
    } catch {
      // Self-state is non-essential — silent fallback.
      selfBlock = null;
    }

    const interactionContext = [signalsBlock, selfBlock]
      .filter((s): s is string => Boolean(s))
      .join("\n\n") || null;

    return NextResponse.json({ interactionContext });
  } catch (err) {
    console.error("[HER Signals API] GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
