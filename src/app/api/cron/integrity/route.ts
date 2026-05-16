/**
 * HER — Nightly Integrity Cron (Step 18.5)
 *
 * GET /api/cron/integrity
 *
 * Runs the integrity audit on a small batch of users per tick. The cron
 * scheduler can call this every 30–60 minutes; we filter to users whose
 * local clock is currently in the 2–3 AM window and only audit those.
 * A persistent cursor in `integrity_checkpoints` ensures we round-robin
 * the whole user base across many ticks, never doing a full DB scan.
 *
 * Safety:
 *   • Bearer / x-cron-secret / ?secret= auth (matches notify+nudge cron).
 *   • Skips users active in the last `activeUserSkipMinutes`.
 *   • Skips users audited in the last `recentAuditSkipHours`.
 *   • Never deletes user data; rules emit only soft repairs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase-client";
import { auditUser } from "@/lib/integrity/audit";
import type {
  IntegrityConversation,
  IntegrityMessage,
  IntegrityScheduledEvent,
  IntegritySignal,
  RuleContext,
} from "@/lib/integrity/rules";
import {
  INTEGRITY_LIMITS,
  type UserAuditReport,
} from "@/lib/integrity/types";
import { scoreFromFindings } from "@/lib/integrity/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHECKPOINT_ID = "users";

interface CandidateUser {
  user_id: string;
  timezone: string;
}

export async function GET(req: NextRequest) {
  // ── Auth: shared cron secret ──
  const authHeader = req.headers.get("authorization");
  const secret =
    authHeader?.replace("Bearer ", "") ||
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json({ error: "No DB" }, { status: 500 });
  }

  // ── Cursor: where did we leave off last tick? ──
  let cursor: string | null = null;
  try {
    const { data } = await client
      .from("integrity_checkpoints")
      .select("cursor")
      .eq("id", CHECKPOINT_ID)
      .maybeSingle();
    cursor = (data?.cursor as string | null) ?? null;
  } catch {
    // Missing table = no cursor = start from beginning.
    cursor = null;
  }

  // ── Fetch the next batch of candidate users from notification_settings ──
  // (notification_settings is the only table with timezone — required for
  // the 2-3 AM local-time gate.)
  let query = client
    .from("notification_settings")
    .select("user_id, timezone")
    .order("user_id", { ascending: true })
    .limit(INTEGRITY_LIMITS.usersPerTick);
  if (cursor) query = query.gt("user_id", cursor);

  const { data: settingsRows, error: settingsErr } = await query;
  if (settingsErr) {
    return NextResponse.json(
      { error: "settings fetch failed", message: settingsErr.message },
      { status: 500 },
    );
  }
  const candidates: CandidateUser[] = (settingsRows ?? []).map((r) => ({
    user_id: r.user_id as string,
    timezone: (r.timezone as string) || "UTC",
  }));

  if (candidates.length === 0) {
    // We've reached the end of the user base — reset cursor for the next pass.
    try {
      await client
        .from("integrity_checkpoints")
        .upsert({ id: CHECKPOINT_ID, cursor: null, updated_at: new Date().toISOString() });
    } catch {
      /* ignore */
    }
    return NextResponse.json({ processed: 0, note: "cursor wrapped to start" });
  }

  // ── For each candidate, gate on local time + active state, then audit ──
  const reports: UserAuditReport[] = [];
  let audited = 0;
  let skippedTimezone = 0;
  let skippedSafety = 0;
  let failures = 0;

  for (const u of candidates) {
    try {
      // Local-time gate (2–3 AM window). Default UTC counts as "any time"
      // is wrong — we want STRICT 2–3 AM, so UTC users get audited only
      // when UTC happens to be 2-3 AM. That's intentional: stagger.
      const hour = getHourInTimezone(u.timezone);
      if (hour !== 2 && hour !== 3) {
        skippedTimezone++;
        continue;
      }

      const report = await auditUser(u.user_id, buildContext, {
        async isActiveNow(userId) {
          const cutoff = new Date(
            Date.now() - INTEGRITY_LIMITS.activeUserSkipMinutes * 60_000,
          ).toISOString();
          const { data: rows } = await client
            .from("conversations")
            .select("id")
            .eq("user_id", userId)
            .gte("last_message_at", cutoff)
            .limit(1);
          return (rows?.length ?? 0) > 0;
        },
        async lastAuditAt(userId) {
          const { data } = await client
            .from("integrity_state")
            .select("last_integrity_check_at")
            .eq("user_id", userId)
            .maybeSingle();
          return (data?.last_integrity_check_at as string | null) ?? null;
        },
        async recordAuditState(report) {
          const allFindings = report.rulesRun.flatMap((r) => r.findings);
          const score = scoreFromFindings(allFindings);
          const summary = {
            findings: allFindings
              .filter((f) => f.detected)
              .map((f) => ({ rule: f.rule, severity: f.severity })),
            repairsApplied: report.repairs.filter((r) => r.applied).length,
          };
          await client.from("integrity_state").upsert({
            user_id: report.userId,
            last_integrity_check_at: report.ranAt,
            last_integrity_repair_at:
              summary.repairsApplied > 0 ? report.ranAt : undefined,
            integrity_score: score,
            last_findings: summary,
            updated_at: new Date().toISOString(),
          });
        },
      });

      if (report.skipped) {
        skippedSafety++;
      } else {
        audited++;
      }
      reports.push(report);
    } catch (err) {
      failures++;
      console.error("[HER Integrity] user audit threw", {
        userId: u.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Advance cursor to the last user we attempted this tick ──
  const newCursor = candidates[candidates.length - 1].user_id;
  try {
    await client
      .from("integrity_checkpoints")
      .upsert({ id: CHECKPOINT_ID, cursor: newCursor, updated_at: new Date().toISOString() });
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    processed: candidates.length,
    audited,
    skippedTimezone,
    skippedSafety,
    failures,
    cursor: newCursor,
  });

  // ── Helpers (closure over `client`) ──
  function buildContext(userId: string): RuleContext {
    return {
      userId,
      async loadMessages(userId) {
        const { data } = await client!
          .from("messages")
          .select(
            "id, conversation_id, role, content, created_at, is_deleted, deleted_at, reactions, reply_to_id",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(500);
        return (data ?? []) as IntegrityMessage[];
      },
      async loadConversations(userId) {
        const { data } = await client!
          .from("conversations")
          .select("id, user_id, last_message_at")
          .eq("user_id", userId)
          .limit(200);
        return (data ?? []) as IntegrityConversation[];
      },
      async loadScheduledEvents(userId) {
        const { data } = await client!
          .from("scheduled_events")
          .select(
            "id, user_id, conversation_id, status, type, created_at, trigger_at, sent_at, followup_sent_at, rescheduled_from_event_id",
          )
          .eq("user_id", userId)
          .limit(200);
        return (data ?? []) as IntegrityScheduledEvent[];
      },
      async loadSignals(userId) {
        const { data } = await client!
          .from("interaction_signals")
          .select(
            "id, user_id, conversation_id, message_id, confidence, created_at, interaction_pattern, engagement_trend",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(200);
        return (data ?? []) as IntegritySignal[];
      },
      async setConversationLastMessageAt(conversationId, iso) {
        const { error } = await client!
          .from("conversations")
          .update({ last_message_at: iso })
          .eq("id", conversationId);
        return !error;
      },
      async cancelScheduledEvent(eventId, reason) {
        const { error } = await client!
          .from("scheduled_events")
          .update({
            status: "cancelled",
            reschedule_reason: reason,
          })
          .eq("id", eventId);
        return !error;
      },
      async sanitizeMessageReactions(messageId, sanitized) {
        const { error } = await client!
          .from("messages")
          .update({ reactions: sanitized })
          .eq("id", messageId);
        return !error;
      },
      async downgradeSignalConfidence(signalId, newConfidence) {
        const { error } = await client!
          .from("interaction_signals")
          .update({ confidence: newConfidence })
          .eq("id", signalId);
        return !error;
      },
      async normalizeScheduledEvent(eventId, patch) {
        const { error } = await client!
          .from("scheduled_events")
          .update(patch)
          .eq("id", eventId);
        return !error;
      },
    };
  }
}

/** Hour (0–23) in the given IANA timezone. Defaults to UTC on bad input. */
function getHourInTimezone(timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour");
    return h ? parseInt(h.value, 10) : new Date().getUTCHours();
  } catch {
    return new Date().getUTCHours();
  }
}
