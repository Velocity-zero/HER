/**
 * HER — Integrity Rules (Step 18.5)
 *
 * Each rule is an isolated audit function. Rules NEVER write to the DB
 * directly — they return findings and optional `RepairAction`s. The
 * repair dispatcher decides whether to apply, based on severity and
 * safety gates.
 *
 * Rules take a `RuleContext` instead of touching Supabase directly so
 * they're unit-testable with in-memory fixtures.
 *
 * Hard rules across this file:
 *   • Never hard-delete user data. We soft-cancel, soft-archive, normalize.
 *   • Never rewrite assistant message content. Repairs touch metadata only.
 *   • Never call an LLM, never embed, never run semantic search.
 *   • Prefer log-only over destructive repair when ambiguity exists.
 */

import type {
  IntegrityFinding,
  RepairAction,
  RuleId,
  RuleResult,
  Severity,
} from "./types";

// ── DB shapes the rules need (kept minimal on purpose) ──────

export interface IntegrityMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  is_deleted: boolean | null;
  deleted_at: string | null;
  reactions: unknown; // JSONB — may be malformed; rules sanitize
  reply_to_id: string | null;
}

export interface IntegrityConversation {
  id: string;
  user_id: string;
  last_message_at: string | null;
}

export interface IntegrityScheduledEvent {
  id: string;
  user_id: string | null;
  conversation_id: string | null;
  status: string;             // 'pending'|'sent'|'cancelled'|'missed'|'completed'|'rescheduled'
  type: string | null;
  created_at: string;
  trigger_at: string | null;
  sent_at: string | null;
  followup_sent_at: string | null;
  rescheduled_from_event_id: string | null;
}

export interface IntegritySignal {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  confidence: number | null;
  created_at: string;
  // Raw enum-ish fields — rules just check truthiness/shape.
  interaction_pattern: string | null;
  engagement_trend: string | null;
}

/**
 * Lightweight DB facade rules call. Implementations are provided by the
 * audit orchestrator (real Supabase) or by the tests (in-memory).
 */
export interface RuleContext {
  userId: string;
  /** Most recent first. Includes soft-deleted rows. */
  loadMessages(userId: string): Promise<IntegrityMessage[]>;
  loadConversations(userId: string): Promise<IntegrityConversation[]>;
  loadScheduledEvents(userId: string): Promise<IntegrityScheduledEvent[]>;
  loadSignals(userId: string): Promise<IntegritySignal[]>;

  /** Repair primitives. Each is idempotent. Returns true on success. */
  setConversationLastMessageAt(conversationId: string, iso: string | null): Promise<boolean>;
  cancelScheduledEvent(eventId: string, reason: string): Promise<boolean>;
  sanitizeMessageReactions(messageId: string, sanitized: Record<string, string[]>): Promise<boolean>;
  downgradeSignalConfidence(signalId: string, newConfidence: number): Promise<boolean>;
  normalizeScheduledEvent(eventId: string, patch: Record<string, unknown>): Promise<boolean>;
}

// ── Tiny helpers ────────────────────────────────────────────

const finding = (
  rule: RuleId,
  severity: Severity,
  detected: boolean,
  repairable: boolean,
  metadata: Record<string, unknown> = {},
): IntegrityFinding => ({ rule, severity, detected, repairable, metadata });

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; durationMs: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - t0 };
}

/**
 * Wrap a rule body in error containment + duration capture. A rule that
 * throws becomes `errored: true` with no findings — the audit continues.
 */
async function runRule(
  rule: RuleId,
  body: () => Promise<{ findings: IntegrityFinding[]; repairs: RepairAction[] }>,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  const t0 = Date.now();
  try {
    const { findings, repairs } = await body();
    return {
      result: { rule, findings, errored: false, durationMs: Date.now() - t0 },
      repairs,
    };
  } catch (err) {
    return {
      result: {
        rule,
        findings: [],
        errored: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      },
      repairs: [],
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  Rule A — Deleted Message Leakage
// ══════════════════════════════════════════════════════════════
//
// Detect signals/replies that reference a message marked is_deleted.
// We log-only — never rewrite assistant history, never auto-prune
// memories (memory entries are facts, not raw quotes, so leakage there
// is rare and risky to auto-clean).
//
export async function ruleDeletedMessageLeakage(
  ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("deleted_message_leakage", async () => {
    const [messages, signals] = await Promise.all([
      ctx.loadMessages(ctx.userId),
      ctx.loadSignals(ctx.userId),
    ]);

    const deletedIds = new Set(
      messages.filter((m) => m.is_deleted).map((m) => m.id),
    );

    // Reply chains pointing at deleted messages.
    const danglingReplies = messages.filter(
      (m) => m.reply_to_id && deletedIds.has(m.reply_to_id),
    );

    // Signals tied to a deleted message_id.
    const leakedSignals = signals.filter(
      (s) => s.message_id && deletedIds.has(s.message_id),
    );

    const detected = danglingReplies.length > 0 || leakedSignals.length > 0;

    const findings: IntegrityFinding[] = [];
    if (detected) {
      findings.push(
        finding("deleted_message_leakage", "low", true, false, {
          danglingReplyCount: danglingReplies.length,
          leakedSignalCount: leakedSignals.length,
          // Sample only — keep logs small.
          sampleSignalIds: leakedSignals.slice(0, 3).map((s) => s.id),
        }),
      );
    }
    // No auto-repair here — assistant history is sacred, memory pruning
    // is too risky. Logging is the deliberate behaviour.
    return { findings, repairs: [] };
  });
}

// ══════════════════════════════════════════════════════════════
//  Rule B — Conversation Pointer Drift
// ══════════════════════════════════════════════════════════════
//
// `conversations.last_message_at` should match the newest non-deleted
// message in that conversation. When it drifts (a message was deleted,
// a write was missed) we recompute from the actual messages.
//
export async function ruleConversationPointerDrift(
  ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("conversation_pointer_drift", async () => {
    const [convos, messages] = await Promise.all([
      ctx.loadConversations(ctx.userId),
      ctx.loadMessages(ctx.userId),
    ]);

    // Group newest-non-deleted message per conversation.
    const newestByConvo = new Map<string, string | null>();
    for (const m of messages) {
      if (m.is_deleted) continue;
      const existing = newestByConvo.get(m.conversation_id);
      if (!existing || m.created_at > existing) {
        newestByConvo.set(m.conversation_id, m.created_at);
      }
    }

    const findings: IntegrityFinding[] = [];
    const repairs: RepairAction[] = [];

    for (const c of convos) {
      const actual = newestByConvo.get(c.id) ?? null;
      const claimed = c.last_message_at;

      // Treat "differ by > 1s" as drift (avoid noise from clock skew).
      const drifted =
        (actual === null && claimed !== null) ||
        (actual !== null && claimed === null) ||
        (actual !== null &&
          claimed !== null &&
          Math.abs(new Date(actual).getTime() - new Date(claimed).getTime()) >
            1_000);

      if (!drifted) continue;

      findings.push(
        finding("conversation_pointer_drift", "low", true, true, {
          conversationId: c.id,
          claimed,
          actual,
        }),
      );

      repairs.push({
        rule: "conversation_pointer_drift",
        description: `Recompute conversations.last_message_at for ${c.id}`,
        before: { last_message_at: claimed },
        after: { last_message_at: actual },
        apply: () => ctx.setConversationLastMessageAt(c.id, actual),
      });
    }

    return { findings, repairs };
  });
}

// ══════════════════════════════════════════════════════════════
//  Rule C — Orphaned Events
// ══════════════════════════════════════════════════════════════
//
// Detect scheduled_events with impossible state:
//   • conversation_id set but no matching conversation in user's set
//   • sent_at < created_at (clock-skew or bad write)
//   • duplicate pending reminders (same conversation + trigger window)
//
// Repairs:
//   • Cancel obviously-orphaned events (status -> 'cancelled') — NEVER delete.
//   • Merge dup pendings by cancelling all but the earliest.
//
export async function ruleOrphanedEvents(
  ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("orphaned_events", async () => {
    const [events, convos] = await Promise.all([
      ctx.loadScheduledEvents(ctx.userId),
      ctx.loadConversations(ctx.userId),
    ]);
    const convoIds = new Set(convos.map((c) => c.id));

    const findings: IntegrityFinding[] = [];
    const repairs: RepairAction[] = [];

    // ── Orphans by missing conversation ──
    for (const e of events) {
      if (e.status === "cancelled" || e.status === "completed") continue;
      if (e.conversation_id && !convoIds.has(e.conversation_id)) {
        findings.push(
          finding("orphaned_events", "medium", true, true, {
            eventId: e.id,
            reason: "conversation_missing",
            conversation_id: e.conversation_id,
          }),
        );
        repairs.push({
          rule: "orphaned_events",
          description: `Cancel event ${e.id} (conversation missing)`,
          before: { status: e.status },
          after: { status: "cancelled" },
          apply: () => ctx.cancelScheduledEvent(e.id, "conversation_missing"),
        });
      }

      if (
        e.sent_at &&
        e.created_at &&
        new Date(e.sent_at).getTime() < new Date(e.created_at).getTime()
      ) {
        findings.push(
          finding("orphaned_events", "low", true, false, {
            eventId: e.id,
            reason: "sent_before_created",
          }),
        );
        // Log-only — don't auto-touch lifecycle timestamps; cron writes them.
      }
    }

    // ── Duplicate pendings ──
    const pendingsByKey = new Map<string, IntegrityScheduledEvent[]>();
    for (const e of events) {
      if (e.status !== "pending" || !e.trigger_at) continue;
      // Bucket by conversation + 5-minute trigger window.
      const bucket = Math.floor(new Date(e.trigger_at).getTime() / (5 * 60_000));
      const key = `${e.conversation_id ?? "none"}|${e.type ?? "?"}|${bucket}`;
      const arr = pendingsByKey.get(key) ?? [];
      arr.push(e);
      pendingsByKey.set(key, arr);
    }
    for (const dupes of pendingsByKey.values()) {
      if (dupes.length < 2) continue;
      // Keep earliest (by created_at), cancel the rest.
      const sorted = [...dupes].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      const toCancel = sorted.slice(1);
      findings.push(
        finding("orphaned_events", "low", true, true, {
          reason: "duplicate_pending",
          keptId: sorted[0].id,
          cancelIds: toCancel.map((e) => e.id),
        }),
      );
      for (const e of toCancel) {
        repairs.push({
          rule: "orphaned_events",
          description: `Cancel duplicate pending event ${e.id}`,
          before: { status: e.status },
          after: { status: "cancelled" },
          apply: () => ctx.cancelScheduledEvent(e.id, "duplicate_pending"),
        });
      }
    }

    return { findings, repairs };
  });
}

// ══════════════════════════════════════════════════════════════
//  Rule D — Broken Reactions
// ══════════════════════════════════════════════════════════════
//
// `messages.reactions` is JSONB shaped { emoji: ["user"|"her", ...] }.
// We sanitize structurally-broken values into the closest valid shape.
// Reactions on deleted messages stay — the row is still there, the
// reactions are still semantic; deletion is soft.
//
export function sanitizeReactions(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [emoji, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof emoji !== "string" || emoji.length === 0 || emoji.length > 16) continue;
    if (!Array.isArray(value)) continue;
    const cleaned = value
      .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length < 64)
      // Dedup while preserving order.
      .filter((v, i, a) => a.indexOf(v) === i);
    if (cleaned.length > 0) out[emoji] = cleaned;
  }
  return out;
}

export async function ruleBrokenReactions(
  ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("broken_reactions", async () => {
    const messages = await ctx.loadMessages(ctx.userId);
    const findings: IntegrityFinding[] = [];
    const repairs: RepairAction[] = [];

    for (const m of messages) {
      if (m.reactions === null || m.reactions === undefined) continue;
      const sanitized = sanitizeReactions(m.reactions);
      const originalSerialized = JSON.stringify(m.reactions);
      const sanitizedSerialized = JSON.stringify(sanitized);
      if (originalSerialized === sanitizedSerialized) continue;

      findings.push(
        finding("broken_reactions", "low", true, true, {
          messageId: m.id,
          before: m.reactions,
          after: sanitized,
        }),
      );
      repairs.push({
        rule: "broken_reactions",
        description: `Sanitize reactions on message ${m.id}`,
        before: { reactions: m.reactions },
        after: { reactions: sanitized },
        apply: () => ctx.sanitizeMessageReactions(m.id, sanitized),
      });
    }

    return { findings, repairs };
  });
}

// ══════════════════════════════════════════════════════════════
//  Rule E — Summary Drift
// ══════════════════════════════════════════════════════════════
//
// HER does NOT persist conversation summaries — `buildConversationSummary`
// in src/lib/context.ts runs at prompt-assembly time. There is therefore
// no stored summary to drift. We keep this rule as a sentinel: if a
// future change introduces a stored summary table, the rule already
// exists in the registry and can be extended.
//
// For now we log a single info-level "no-op" finding so the audit shape
// stays consistent across rules. No repairs are emitted.
//
export async function ruleSummaryDrift(
  _ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("summary_drift", async () => {
    return {
      findings: [
        finding("summary_drift", "info", false, false, {
          note: "summaries are runtime-only; nothing persisted to reconcile",
        }),
      ],
      repairs: [],
    };
  });
}

// ══════════════════════════════════════════════════════════════
//  Rule F — Signal Drift
// ══════════════════════════════════════════════════════════════
//
// Detect:
//   • interaction_signals with message_id pointing at a deleted message
//     → downgrade confidence (don't delete behavioural history)
//   • malformed enums (null/empty interaction_pattern AND null engagement)
//     → log only (no safe canonical value)
//   • confidence > 1.0 or < 0.0 → clamp via downgrade
//
export async function ruleSignalDrift(
  ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("signal_drift", async () => {
    const [signals, messages] = await Promise.all([
      ctx.loadSignals(ctx.userId),
      ctx.loadMessages(ctx.userId),
    ]);
    const deletedIds = new Set(
      messages.filter((m) => m.is_deleted).map((m) => m.id),
    );

    const findings: IntegrityFinding[] = [];
    const repairs: RepairAction[] = [];

    for (const s of signals) {
      let needsDowngrade = false;
      let reason = "";

      if (s.message_id && deletedIds.has(s.message_id)) {
        needsDowngrade = true;
        reason = "tied_to_deleted_message";
      } else if (s.confidence !== null && (s.confidence > 1 || s.confidence < 0)) {
        needsDowngrade = true;
        reason = "confidence_out_of_range";
      } else if (
        (!s.interaction_pattern || s.interaction_pattern.length === 0) &&
        (!s.engagement_trend || s.engagement_trend.length === 0)
      ) {
        // Malformed-enum case — log only, no obvious canonical fix.
        findings.push(
          finding("signal_drift", "low", true, false, {
            signalId: s.id,
            reason: "malformed_enums",
          }),
        );
        continue;
      }

      if (!needsDowngrade) continue;

      const next = Math.min(0.3, Math.max(0, (s.confidence ?? 0.3) * 0.5));
      findings.push(
        finding("signal_drift", "low", true, true, {
          signalId: s.id,
          reason,
          beforeConfidence: s.confidence,
          afterConfidence: next,
        }),
      );
      repairs.push({
        rule: "signal_drift",
        description: `Downgrade signal ${s.id} confidence (${reason})`,
        before: { confidence: s.confidence },
        after: { confidence: next },
        apply: () => ctx.downgradeSignalConfidence(s.id, next),
      });
    }

    return { findings, repairs };
  });
}

// ══════════════════════════════════════════════════════════════
//  Rule G — Notification Drift
// ══════════════════════════════════════════════════════════════
//
// Detect:
//   • followup_sent_at set while status='pending' → revert followup
//   • status='missed' but missed_at is null → can't safely set time, log only
//   • status='sent' but sent_at null → backfill sent_at = trigger_at
//   • rescheduled chain depth > 5 → loop suspect, log critical (no repair)
//
export async function ruleNotificationDrift(
  ctx: RuleContext,
): Promise<{ result: RuleResult; repairs: RepairAction[] }> {
  return runRule("notification_drift", async () => {
    const events = await ctx.loadScheduledEvents(ctx.userId);
    const findings: IntegrityFinding[] = [];
    const repairs: RepairAction[] = [];

    // Quick lookup for chain depth.
    const byId = new Map(events.map((e) => [e.id, e]));

    for (const e of events) {
      if (e.status === "pending" && e.followup_sent_at) {
        findings.push(
          finding("notification_drift", "medium", true, true, {
            eventId: e.id,
            reason: "followup_set_while_pending",
          }),
        );
        repairs.push({
          rule: "notification_drift",
          description: `Clear stray followup_sent_at on pending event ${e.id}`,
          before: { followup_sent_at: e.followup_sent_at },
          after: { followup_sent_at: null },
          apply: () => ctx.normalizeScheduledEvent(e.id, { followup_sent_at: null }),
        });
      }

      if (e.status === "sent" && !e.sent_at && e.trigger_at) {
        findings.push(
          finding("notification_drift", "low", true, true, {
            eventId: e.id,
            reason: "sent_without_sent_at",
          }),
        );
        repairs.push({
          rule: "notification_drift",
          description: `Backfill sent_at = trigger_at on event ${e.id}`,
          before: { sent_at: null },
          after: { sent_at: e.trigger_at },
          apply: () => ctx.normalizeScheduledEvent(e.id, { sent_at: e.trigger_at }),
        });
      }

      if (e.status === "missed" && !e.sent_at) {
        // Can't infer when it was sent — log only.
        findings.push(
          finding("notification_drift", "low", true, false, {
            eventId: e.id,
            reason: "missed_without_sent_at",
          }),
        );
      }

      // Rescheduled chain depth — walk back the linked list.
      if (e.rescheduled_from_event_id) {
        let depth = 1;
        let cursor: string | null = e.rescheduled_from_event_id;
        const visited = new Set<string>([e.id]);
        while (cursor && depth <= 8) {
          if (visited.has(cursor)) {
            // Actual cycle — never auto-repair, log loud.
            findings.push(
              finding("notification_drift", "critical", true, false, {
                eventId: e.id,
                reason: "rescheduled_cycle",
                cycleAt: cursor,
              }),
            );
            break;
          }
          visited.add(cursor);
          const parent = byId.get(cursor);
          if (!parent) break;
          cursor = parent.rescheduled_from_event_id;
          depth++;
        }
        if (depth > 5) {
          findings.push(
            finding("notification_drift", "high", true, false, {
              eventId: e.id,
              reason: "rescheduled_chain_too_long",
              depth,
            }),
          );
          // High severity: no auto-repair. Log only.
        }
      }
    }

    return { findings, repairs };
  });
}

// ── Registry ──────────────────────────────────────────────────

export const ALL_RULES = [
  ruleDeletedMessageLeakage,
  ruleConversationPointerDrift,
  ruleOrphanedEvents,
  ruleBrokenReactions,
  ruleSummaryDrift,
  ruleSignalDrift,
  ruleNotificationDrift,
] as const;

// Silence unused-warning for `timed` (kept exported-style for future use)
export { timed };
