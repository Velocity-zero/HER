/**
 * HER — Integrity System Tests (Step 18.5)
 *
 * Pure in-memory tests for all 7 rules + orchestrator + dispatcher.
 * No Supabase, no clock, no I/O — every fixture is constructed inline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeReactions,
  ruleConversationPointerDrift,
  ruleOrphanedEvents,
  ruleBrokenReactions,
  ruleDeletedMessageLeakage,
  ruleSignalDrift,
  ruleNotificationDrift,
  ruleSummaryDrift,
  type RuleContext,
  type IntegrityMessage,
  type IntegrityConversation,
  type IntegrityScheduledEvent,
  type IntegritySignal,
} from "../../src/lib/integrity/rules.js";
import { dispatchRepairs } from "../../src/lib/integrity/repair.js";
import { auditUser, scoreFromFindings } from "../../src/lib/integrity/audit.js";

// ── Fixture builder ─────────────────────────────────────────

interface Fixture {
  messages: IntegrityMessage[];
  conversations: IntegrityConversation[];
  events: IntegrityScheduledEvent[];
  signals: IntegritySignal[];
  writes: { method: string; args: unknown[] }[];
  failingMethods?: Set<string>;
}

function makeCtx(userId: string, fix: Fixture): RuleContext {
  const track = (method: string, args: unknown[]): boolean => {
    fix.writes.push({ method, args });
    return !fix.failingMethods?.has(method);
  };
  return {
    userId,
    loadMessages: async () => fix.messages,
    loadConversations: async () => fix.conversations,
    loadScheduledEvents: async () => fix.events,
    loadSignals: async () => fix.signals,
    setConversationLastMessageAt: async (id, iso) =>
      track("setConversationLastMessageAt", [id, iso]),
    cancelScheduledEvent: async (id, reason) =>
      track("cancelScheduledEvent", [id, reason]),
    sanitizeMessageReactions: async (id, s) =>
      track("sanitizeMessageReactions", [id, s]),
    downgradeSignalConfidence: async (id, c) =>
      track("downgradeSignalConfidence", [id, c]),
    normalizeScheduledEvent: async (id, p) =>
      track("normalizeScheduledEvent", [id, p]),
  };
}

const isoNow = new Date("2025-01-01T12:00:00Z").toISOString();
const isoEarlier = new Date("2024-12-31T12:00:00Z").toISOString();

function emptyFix(): Fixture {
  return { messages: [], conversations: [], events: [], signals: [], writes: [] };
}

// ══════════════════════════════════════════════════════════════
//  sanitizeReactions (helper coverage)
// ══════════════════════════════════════════════════════════════

test("sanitizeReactions — null/undefined/non-object → empty object", () => {
  assert.deepEqual(sanitizeReactions(null), {});
  assert.deepEqual(sanitizeReactions(undefined), {});
  assert.deepEqual(sanitizeReactions("oops"), {});
  assert.deepEqual(sanitizeReactions([1, 2, 3]), {});
});

test("sanitizeReactions — drops non-array values and dedupes", () => {
  const result = sanitizeReactions({
    "❤️": ["user", "user", "her"],
    "💀": "not an array",
    "": ["user"],
    ["x".repeat(50)]: ["user"], // too long an emoji key
  });
  assert.deepEqual(result, { "❤️": ["user", "her"] });
});

test("sanitizeReactions — preserves a clean structure unchanged", () => {
  const clean = { "🔥": ["user"], "🙂": ["her", "user"] };
  assert.deepEqual(sanitizeReactions(clean), clean);
});

// ══════════════════════════════════════════════════════════════
//  Rule A — Deleted Message Leakage
// ══════════════════════════════════════════════════════════════

test("Rule A — detects signals + replies pointing at deleted messages, repairs=0", async () => {
  const fix = emptyFix();
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "user", content: "x",
      created_at: isoEarlier, is_deleted: true, deleted_at: isoNow,
      reactions: null, reply_to_id: null,
    },
    {
      id: "m2", conversation_id: "c1", role: "assistant", content: "y",
      created_at: isoNow, is_deleted: false, deleted_at: null,
      reactions: null, reply_to_id: "m1",
    },
  ];
  fix.signals = [
    {
      id: "s1", user_id: "u", conversation_id: "c1", message_id: "m1",
      confidence: 0.9, created_at: isoNow,
      interaction_pattern: "ok", engagement_trend: "neutral",
    },
  ];
  const ctx = makeCtx("u", fix);
  const out = await ruleDeletedMessageLeakage(ctx);
  assert.equal(out.result.errored, false);
  assert.equal(out.result.findings[0].detected, true);
  assert.equal(out.repairs.length, 0, "Rule A is log-only");
});

// ══════════════════════════════════════════════════════════════
//  Rule B — Conversation Pointer Drift
// ══════════════════════════════════════════════════════════════

test("Rule B — recomputes last_message_at when it drifts", async () => {
  const fix = emptyFix();
  fix.conversations = [{ id: "c1", user_id: "u", last_message_at: isoEarlier }];
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "assistant", content: "hi",
      created_at: isoNow, is_deleted: false, deleted_at: null,
      reactions: null, reply_to_id: null,
    },
  ];
  const ctx = makeCtx("u", fix);
  const out = await ruleConversationPointerDrift(ctx);
  assert.equal(out.repairs.length, 1);
  await out.repairs[0].apply();
  assert.equal(fix.writes[0].method, "setConversationLastMessageAt");
  assert.deepEqual(fix.writes[0].args, ["c1", isoNow]);
});

test("Rule B — no drift means no repair (clean case)", async () => {
  const fix = emptyFix();
  fix.conversations = [{ id: "c1", user_id: "u", last_message_at: isoNow }];
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "user", content: "ping",
      created_at: isoNow, is_deleted: false, deleted_at: null,
      reactions: null, reply_to_id: null,
    },
  ];
  const ctx = makeCtx("u", fix);
  const out = await ruleConversationPointerDrift(ctx);
  assert.equal(out.repairs.length, 0);
  assert.equal(out.result.findings.length, 0);
});

// ══════════════════════════════════════════════════════════════
//  Rule C — Orphaned + Duplicate Events
// ══════════════════════════════════════════════════════════════

test("Rule C — cancels event whose conversation no longer exists", async () => {
  const fix = emptyFix();
  fix.conversations = [{ id: "c1", user_id: "u", last_message_at: isoNow }];
  fix.events = [
    {
      id: "e1", user_id: "u", conversation_id: "gone", status: "pending",
      type: "reminder", created_at: isoEarlier, trigger_at: isoNow,
      sent_at: null, followup_sent_at: null, rescheduled_from_event_id: null,
    },
  ];
  const ctx = makeCtx("u", fix);
  const out = await ruleOrphanedEvents(ctx);
  const cancelRepair = out.repairs.find((r) => r.description.includes("conversation missing"));
  assert.ok(cancelRepair, "expected an orphan-cancel repair");
  await cancelRepair!.apply();
  assert.equal(fix.writes[0].method, "cancelScheduledEvent");
});

test("Rule C — merges duplicate pending reminders (keep earliest, cancel rest)", async () => {
  const fix = emptyFix();
  fix.events = [
    {
      id: "earliest", user_id: "u", conversation_id: "c1", status: "pending",
      type: "reminder", created_at: "2024-01-01T00:00:00Z", trigger_at: isoNow,
      sent_at: null, followup_sent_at: null, rescheduled_from_event_id: null,
    },
    {
      id: "dup1", user_id: "u", conversation_id: "c1", status: "pending",
      type: "reminder", created_at: "2024-01-02T00:00:00Z", trigger_at: isoNow,
      sent_at: null, followup_sent_at: null, rescheduled_from_event_id: null,
    },
    {
      id: "dup2", user_id: "u", conversation_id: "c1", status: "pending",
      type: "reminder", created_at: "2024-01-03T00:00:00Z", trigger_at: isoNow,
      sent_at: null, followup_sent_at: null, rescheduled_from_event_id: null,
    },
  ];
  fix.conversations = [{ id: "c1", user_id: "u", last_message_at: isoNow }];
  const ctx = makeCtx("u", fix);
  const out = await ruleOrphanedEvents(ctx);
  const dupRepairs = out.repairs.filter((r) => r.description.includes("duplicate"));
  assert.equal(dupRepairs.length, 2);
  for (const r of dupRepairs) await r.apply();
  const cancelled = fix.writes
    .filter((w) => w.method === "cancelScheduledEvent")
    .map((w) => (w.args[0] as string));
  assert.deepEqual(cancelled.sort(), ["dup1", "dup2"]);
});

// ══════════════════════════════════════════════════════════════
//  Rule D — Broken Reactions
// ══════════════════════════════════════════════════════════════

test("Rule D — repairs malformed reactions JSON", async () => {
  const fix = emptyFix();
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "assistant", content: "hi",
      created_at: isoNow, is_deleted: false, deleted_at: null,
      reactions: { "❤️": "not an array", "🔥": ["user", "user"] },
      reply_to_id: null,
    },
  ];
  const ctx = makeCtx("u", fix);
  const out = await ruleBrokenReactions(ctx);
  assert.equal(out.repairs.length, 1);
  await out.repairs[0].apply();
  assert.deepEqual(fix.writes[0].args[1], { "🔥": ["user"] });
});

test("Rule D — clean reactions produce no repair (idempotence baseline)", async () => {
  const fix = emptyFix();
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "assistant", content: "hi",
      created_at: isoNow, is_deleted: false, deleted_at: null,
      reactions: { "🔥": ["user"] }, reply_to_id: null,
    },
  ];
  const out = await ruleBrokenReactions(makeCtx("u", fix));
  assert.equal(out.repairs.length, 0);
});

// ══════════════════════════════════════════════════════════════
//  Rule E — Summary Drift (sentinel)
// ══════════════════════════════════════════════════════════════

test("Rule E — emits a no-op sentinel finding, no repairs", async () => {
  const out = await ruleSummaryDrift(makeCtx("u", emptyFix()));
  assert.equal(out.result.errored, false);
  assert.equal(out.repairs.length, 0);
  assert.equal(out.result.findings[0].severity, "info");
});

// ══════════════════════════════════════════════════════════════
//  Rule F — Signal Drift
// ══════════════════════════════════════════════════════════════

test("Rule F — downgrades confidence on signals tied to deleted messages", async () => {
  const fix = emptyFix();
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "user", content: "x",
      created_at: isoEarlier, is_deleted: true, deleted_at: isoNow,
      reactions: null, reply_to_id: null,
    },
  ];
  fix.signals = [
    {
      id: "s1", user_id: "u", conversation_id: "c1", message_id: "m1",
      confidence: 0.9, created_at: isoNow,
      interaction_pattern: "ok", engagement_trend: "neutral",
    },
  ];
  const out = await ruleSignalDrift(makeCtx("u", fix));
  assert.equal(out.repairs.length, 1);
  await out.repairs[0].apply();
  const args = fix.writes[0].args as [string, number];
  assert.equal(args[0], "s1");
  assert.ok(args[1] < 0.9);
});

// ══════════════════════════════════════════════════════════════
//  Rule G — Notification Drift
// ══════════════════════════════════════════════════════════════

test("Rule G — clears stray followup_sent_at on pending event", async () => {
  const fix = emptyFix();
  fix.events = [
    {
      id: "e1", user_id: "u", conversation_id: "c1", status: "pending",
      type: "reminder", created_at: isoEarlier, trigger_at: isoNow,
      sent_at: null, followup_sent_at: isoNow, rescheduled_from_event_id: null,
    },
  ];
  const out = await ruleNotificationDrift(makeCtx("u", fix));
  const repair = out.repairs.find((r) => r.description.includes("stray followup"));
  assert.ok(repair);
  await repair!.apply();
  assert.equal(fix.writes[0].method, "normalizeScheduledEvent");
  assert.deepEqual(fix.writes[0].args[1], { followup_sent_at: null });
});

test("Rule G — detects cycle and emits critical finding (no auto-repair)", async () => {
  const fix = emptyFix();
  fix.events = [
    {
      id: "a", user_id: "u", conversation_id: "c1", status: "pending",
      type: "reminder", created_at: isoEarlier, trigger_at: isoNow,
      sent_at: null, followup_sent_at: null, rescheduled_from_event_id: "b",
    },
    {
      id: "b", user_id: "u", conversation_id: "c1", status: "pending",
      type: "reminder", created_at: isoEarlier, trigger_at: isoNow,
      sent_at: null, followup_sent_at: null, rescheduled_from_event_id: "a",
    },
  ];
  const out = await ruleNotificationDrift(makeCtx("u", fix));
  const critical = out.result.findings.find((f) => f.severity === "critical");
  assert.ok(critical, "expected a critical cycle finding");
  // Critical findings never produce repairs.
  assert.equal(out.repairs.length, 0);
});

// ══════════════════════════════════════════════════════════════
//  Dispatcher — idempotence, halts, cap
// ══════════════════════════════════════════════════════════════

test("Dispatcher — idempotent: re-running with the same input never re-applies", async () => {
  const fix = emptyFix();
  fix.conversations = [{ id: "c1", user_id: "u", last_message_at: isoEarlier }];
  fix.messages = [
    {
      id: "m1", conversation_id: "c1", role: "user", content: "x",
      created_at: isoNow, is_deleted: false, deleted_at: null,
      reactions: null, reply_to_id: null,
    },
  ];
  const ctx = makeCtx("u", fix);
  // First pass — drift exists, dispatcher applies the repair.
  const pass1 = await ruleConversationPointerDrift(ctx);
  const d1 = await dispatchRepairs({
    userId: "u", rulesRun: [pass1.result], repairs: pass1.repairs,
  });
  assert.equal(d1.applied.length, 1);
  // Simulate the post-repair state.
  fix.conversations[0].last_message_at = isoNow;
  const pass2 = await ruleConversationPointerDrift(ctx);
  const d2 = await dispatchRepairs({
    userId: "u", rulesRun: [pass2.result], repairs: pass2.repairs,
  });
  assert.equal(d2.applied.length, 0, "second pass should be a no-op");
});

test("Dispatcher — refuses to apply when rule emitted a critical finding", async () => {
  const fakeRepair = {
    rule: "notification_drift" as const,
    description: "x",
    before: {}, after: {},
    apply: async () => true,
  };
  const out = await dispatchRepairs({
    userId: "u",
    rulesRun: [{
      rule: "notification_drift",
      findings: [{
        rule: "notification_drift", severity: "critical",
        detected: true, repairable: false, metadata: {},
      }],
      errored: false, durationMs: 1,
    }],
    repairs: [fakeRepair],
  });
  assert.equal(out.applied.length, 0);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].reason, "skipped_critical_severity");
});

// ══════════════════════════════════════════════════════════════
//  Orchestrator — active-user skip, recent-audit skip
// ══════════════════════════════════════════════════════════════

test("Orchestrator — skips when user is currently active", async () => {
  const report = await auditUser(
    "u",
    () => makeCtx("u", emptyFix()),
    {
      isActiveNow: async () => true,
      lastAuditAt: async () => null,
    },
  );
  assert.equal(report.skipped, true);
  assert.equal(report.skipReason, "user_active");
  assert.equal(report.rulesRun.length, 0);
});

test("Orchestrator — skips when audit ran recently", async () => {
  const justNow = new Date().toISOString();
  const report = await auditUser(
    "u",
    () => makeCtx("u", emptyFix()),
    {
      isActiveNow: async () => false,
      lastAuditAt: async () => justNow,
    },
  );
  assert.equal(report.skipped, true);
  assert.equal(report.skipReason, "recent_audit");
});

test("Orchestrator — clean user produces clean report and score 1.0", async () => {
  const report = await auditUser(
    "u",
    () => makeCtx("u", emptyFix()),
    { isActiveNow: async () => false, lastAuditAt: async () => null },
  );
  assert.equal(report.skipped, false);
  assert.equal(report.rulesRun.length, 7);
  assert.equal(report.repairs.length, 0);
  const findings = report.rulesRun.flatMap((r) => r.findings.filter((f) => f.detected));
  assert.equal(scoreFromFindings(findings), 1.0);
});

// ══════════════════════════════════════════════════════════════
//  Cursor / checkpoint shape (light)
// ══════════════════════════════════════════════════════════════

test("scoreFromFindings — penalises severity progressively", () => {
  const low = scoreFromFindings([
    { rule: "broken_reactions", severity: "low", detected: true, repairable: true, metadata: {} },
  ]);
  const high = scoreFromFindings([
    { rule: "notification_drift", severity: "high", detected: true, repairable: false, metadata: {} },
  ]);
  assert.ok(low > high, "low severity should give a higher score than high severity");
});
