/**
 * HER — Spontaneous Outreach (Step 17.8) — pure decision tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildConversationLifecycle,
  getOutreachType,
  getOutreachProbability,
} from "../../src/lib/conversation-lifecycle.js";
import {
  canSendSpontaneousOutreach,
  briefForOutreach,
  CONTINUITY_BRIEF,
  FRESH_BRIEF,
} from "../../src/lib/nudge-logic.js";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-05-12T12:00:00Z");

function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

// ── getOutreachType ────────────────────────────────────────

test("getOutreachType — active/cooling map to continuity", () => {
  assert.equal(getOutreachType(buildConversationLifecycle(ago(2), NOW)), "continuity");
  assert.equal(getOutreachType(buildConversationLifecycle(ago(36), NOW)), "continuity");
});

test("getOutreachType — dormant/reengageable map to fresh", () => {
  assert.equal(getOutreachType(buildConversationLifecycle(ago(60), NOW)), "fresh");
  assert.equal(getOutreachType(buildConversationLifecycle(ago(96), NOW)), "fresh");
});

// ── getOutreachProbability — decay curve ───────────────────

test("outreach probability decays with silence", () => {
  assert.equal(getOutreachProbability(ago(2), NOW), 1.0);
  assert.equal(getOutreachProbability(ago(36), NOW), 0.7);
  assert.equal(getOutreachProbability(ago(60), NOW), 0.3);
  assert.equal(getOutreachProbability(ago(96), NOW), 0.15); // 4 days
  assert.equal(getOutreachProbability(ago(24 * 14), NOW), 0.04); // 2 weeks
});

test("outreach probability is monotonically non-increasing across boundaries", () => {
  const probs = [2, 25, 49, 73, 24 * 8, 24 * 30].map((h) =>
    getOutreachProbability(ago(h), NOW),
  );
  for (let i = 1; i < probs.length; i++) {
    assert.ok(probs[i] <= probs[i - 1], `prob ${probs[i]} > ${probs[i - 1]}`);
  }
});

// ── canSendSpontaneousOutreach ─────────────────────────────

const baseInputs = {
  lifecycle: buildConversationLifecycle(ago(2), NOW),
  ignoredCount24h: 0,
  notificationsEnabled: true,
};

test("spontaneous — active thread allowed", () => {
  const d = canSendSpontaneousOutreach(baseInputs);
  assert.equal(d.allowed, true);
  assert.equal(d.outreachType, "continuity");
});

test("spontaneous — cooling thread allowed (continuity)", () => {
  const d = canSendSpontaneousOutreach({
    ...baseInputs,
    lifecycle: buildConversationLifecycle(ago(36), NOW),
  });
  assert.equal(d.allowed, true);
  assert.equal(d.outreachType, "continuity");
});

test("spontaneous — reengageable allowed (fresh)", () => {
  const d = canSendSpontaneousOutreach({
    ...baseInputs,
    lifecycle: buildConversationLifecycle(ago(96), NOW),
  });
  assert.equal(d.allowed, true);
  assert.equal(d.outreachType, "fresh");
});

test("spontaneous — dormant skipped most of the time", () => {
  const lifecycle = buildConversationLifecycle(ago(60), NOW);
  // random=0.5 (>= 0.2 cutoff) → blocked
  const blocked = canSendSpontaneousOutreach({
    ...baseInputs,
    lifecycle,
    random: () => 0.5,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.suppressedReason, "dormant_skip");

  // random=0.05 (< 0.2 cutoff) → allowed
  const allowed = canSendSpontaneousOutreach({
    ...baseInputs,
    lifecycle,
    random: () => 0.05,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.outreachType, "fresh");
});

test("spontaneous — fatigue (≥3 ignored) blocks regardless of state", () => {
  for (const hours of [2, 36, 60, 96]) {
    const d = canSendSpontaneousOutreach({
      ...baseInputs,
      lifecycle: buildConversationLifecycle(ago(hours), NOW),
      ignoredCount24h: 3,
    });
    assert.equal(d.allowed, false, `hours=${hours} should be blocked by fatigue`);
    assert.equal(d.suppressedReason, "fatigue");
  }
});

test("spontaneous — disabled notifications block immediately", () => {
  const d = canSendSpontaneousOutreach({
    ...baseInputs,
    notificationsEnabled: false,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.suppressedReason, "notifications_disabled");
});

// ── briefs ─────────────────────────────────────────────────

test("briefForOutreach — picks the right brief", () => {
  assert.equal(briefForOutreach("continuity"), CONTINUITY_BRIEF);
  assert.equal(briefForOutreach("fresh"), FRESH_BRIEF);
});

test("FRESH_BRIEF tells the model not to fake continuity", () => {
  assert.match(FRESH_BRIEF, /cool|fresh|spontaneous/i);
  assert.match(FRESH_BRIEF, /not.*pretend|do not force/i);
});

test("CONTINUITY_BRIEF tells the model not to be a cold opener", () => {
  assert.match(CONTINUITY_BRIEF, /continue|continuation|natural/i);
  assert.match(CONTINUITY_BRIEF, /avoid.*opener|generic greetings/i);
});
