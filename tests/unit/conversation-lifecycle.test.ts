/**
 * HER — Conversation Lifecycle (Step 17.7) — pure boundary tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getConversationState,
  buildConversationLifecycle,
  canUseContinuityStyle,
  ACTIVE_WINDOW_MS,
  CONTINUITY_WINDOW_MS,
  DORMANT_WINDOW_MS,
} from "../../src/lib/conversation-lifecycle.js";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-05-12T12:00:00Z");

function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

// ── getConversationState ───────────────────────────────────

test("getConversationState — fresh (<24h) is active", () => {
  assert.equal(getConversationState(ago(0.1), NOW), "active");
  assert.equal(getConversationState(ago(2), NOW), "active");
  assert.equal(getConversationState(ago(23.99), NOW), "active");
});

test("getConversationState — exactly 24h is cooling", () => {
  assert.equal(getConversationState(ago(24), NOW), "cooling");
});

test("getConversationState — 24h–48h is cooling", () => {
  assert.equal(getConversationState(ago(36), NOW), "cooling");
  assert.equal(getConversationState(ago(47.99), NOW), "cooling");
});

test("getConversationState — exactly 48h is dormant", () => {
  assert.equal(getConversationState(ago(48), NOW), "dormant");
});

test("getConversationState — 48h–72h is dormant", () => {
  assert.equal(getConversationState(ago(60), NOW), "dormant");
  assert.equal(getConversationState(ago(71.99), NOW), "dormant");
});

test("getConversationState — exactly 72h is reengageable", () => {
  assert.equal(getConversationState(ago(72), NOW), "reengageable");
});

test("getConversationState — past 72h stays reengageable", () => {
  assert.equal(getConversationState(ago(168), NOW), "reengageable");
  assert.equal(getConversationState(ago(24 * 30), NOW), "reengageable");
});

test("getConversationState — future timestamp (clock skew) collapses to active", () => {
  const future = new Date(NOW.getTime() + 10 * 60 * 1000);
  assert.equal(getConversationState(future, NOW), "active");
});

// ── canUseContinuityStyle ──────────────────────────────────

test("canUseContinuityStyle — allowed for active and cooling", () => {
  assert.equal(canUseContinuityStyle("active"), true);
  assert.equal(canUseContinuityStyle("cooling"), true);
});

test("canUseContinuityStyle — denied for dormant and reengageable", () => {
  assert.equal(canUseContinuityStyle("dormant"), false);
  assert.equal(canUseContinuityStyle("reengageable"), false);
});

test("canUseContinuityStyle — accepts a full lifecycle object", () => {
  const lc = buildConversationLifecycle(ago(2), NOW);
  assert.equal(canUseContinuityStyle(lc), true);
  const lcCold = buildConversationLifecycle(ago(100), NOW);
  assert.equal(canUseContinuityStyle(lcCold), false);
});

// ── buildConversationLifecycle ─────────────────────────────

test("buildConversationLifecycle — derives expiry timestamps from last interaction", () => {
  const last = ago(2);
  const lc = buildConversationLifecycle(last, NOW);
  assert.equal(lc.state, "active");
  assert.equal(lc.lastInteractionAt, last.toISOString());
  assert.equal(
    lc.continuityExpiresAt,
    new Date(last.getTime() + CONTINUITY_WINDOW_MS).toISOString(),
  );
  assert.equal(
    lc.dormantAt,
    new Date(last.getTime() + DORMANT_WINDOW_MS).toISOString(),
  );
});

test("boundary constants match the spec (24h / 48h / 72h)", () => {
  assert.equal(ACTIVE_WINDOW_MS, 24 * HOUR);
  assert.equal(CONTINUITY_WINDOW_MS, 48 * HOUR);
  assert.equal(DORMANT_WINDOW_MS, 72 * HOUR);
});
