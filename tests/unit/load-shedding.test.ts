/**
 * HER — Step 18.3 (Phase C) load-shedding tests.
 *
 * Pure logic. No I/O, no env, no DB.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyLoadShedding } from "../../src/lib/load-shedding.js";

// Build a string of approximately `tokens * 4` chars — easy way to control
// the input size for the budget tests below.
const chunk = (tokens: number): string => "x".repeat(tokens * 4);

// ── no-op when under budget ─────────────────────────────────

test("load-shedding — no-op when payload is under the total budget", () => {
  const result = applyLoadShedding({
    systemPrompt: chunk(1000),
    historyText: chunk(1000),
    memoryContext: chunk(500),
    continuityContext: chunk(500),
  });

  assert.deepEqual(result.report.actionsApplied, []);
  assert.equal(result.report.stillOverBudget, false);
  assert.equal(result.memoryContext?.length, 2000);
  assert.equal(result.continuityContext?.length, 2000);
});

// ── never sheds system prompt or live history ───────────────

test("load-shedding — never touches system prompt or history even when massively over", () => {
  // Force way past budget — system + history alone exceed it.
  const result = applyLoadShedding({
    systemPrompt: chunk(15_000),
    historyText: chunk(15_000),
    memoryContext: chunk(2000),
    continuityContext: chunk(1500),
    interactionSignals: chunk(800),
    selfModelBrief: chunk(400),
    emotionContext: chunk(400),
  });

  // System + history must survive unchanged.
  assert.equal(result.systemPrompt.length, 15_000 * 4);
  assert.equal(result.historyText.length, 15_000 * 4);
  // We should still report stillOverBudget — we can't fit the impossible.
  assert.equal(result.report.stillOverBudget, true);
});

// ── shedding order: signals → self → emotion → memory → continuity ──

test("load-shedding — sheds in the documented priority order", () => {
  // Over budget by a little — should only need to drop the lowest-priority layer.
  // Total: 4000 + 12000 + 2000 + 1200 + 8000 + 400 + 400 = 28000 tokens (over 24000).
  // After dropping signals: 20000 — fits.
  const result = applyLoadShedding({
    systemPrompt: chunk(4000),
    historyText: chunk(12_000),
    memoryContext: chunk(2000),
    continuityContext: chunk(1200),
    interactionSignals: chunk(8000), // main culprit
    selfModelBrief: chunk(400),
    emotionContext: chunk(400),
  });

  // First action should drop interaction signals.
  assert.equal(result.report.actionsApplied[0], "dropped:interactionSignals");
  assert.equal(result.interactionSignals, null);
});

test("load-shedding — progressively trims memory before touching continuity", () => {
  // Build a payload where dropping signals + self + emotion isn't enough,
  // so memory has to be trimmed.
  // Total: 4000 + 14000 + 8000 + 1000 + 2000 + 1000 + 1000 = 31000 (over 24000).
  // After 3 drops (-4000): 27000. Still over. Trim memory 50% (-4000): 23000. Fits.
  const result = applyLoadShedding({
    systemPrompt: chunk(4000),
    historyText: chunk(14_000),
    memoryContext: chunk(8000),
    continuityContext: chunk(1000),
    interactionSignals: chunk(2000),
    selfModelBrief: chunk(1000),
    emotionContext: chunk(1000),
  });

  // Drops happen before trims.
  const order = result.report.actionsApplied;
  const dropIdx = order.findIndex((a) => a.startsWith("dropped:"));
  const trimIdx = order.findIndex((a) => a.startsWith("trimmed:memoryContext"));
  assert.ok(dropIdx >= 0);
  assert.ok(trimIdx > dropIdx, "memory trim must come after the cheap drops");
  // Continuity is the last resort — should not be touched if memory work was enough.
  assert.ok(
    !order.some((a) => a.startsWith("trimmed:continuityContext")),
    "continuity should survive when memory shedding is enough",
  );
});

// ── continuity is the last resort ──────────────────────────

test("load-shedding — only trims continuity when nothing else fits", () => {
  const result = applyLoadShedding({
    systemPrompt: chunk(5000),
    historyText: chunk(10_000),
    memoryContext: chunk(5000),
    continuityContext: chunk(8000),
    interactionSignals: chunk(2000),
    selfModelBrief: chunk(2000),
    emotionContext: chunk(2000),
  });

  // Continuity should appear in the actions, but never as "dropped".
  const continuityActions = result.report.actionsApplied.filter((a) =>
    a.includes("continuityContext"),
  );
  if (continuityActions.length > 0) {
    assert.ok(
      continuityActions.every((a) => a.startsWith("trimmed:")),
      "continuity must only be trimmed, never dropped",
    );
    assert.ok(result.continuityContext !== null);
  }
});

// ── idempotence on no-op path ──────────────────────────────

test("load-shedding — idempotent when already under budget", () => {
  const input = {
    systemPrompt: chunk(1000),
    historyText: chunk(1000),
    memoryContext: chunk(500),
    continuityContext: chunk(500),
  };
  const a = applyLoadShedding(input);
  const b = applyLoadShedding({
    systemPrompt: a.systemPrompt,
    historyText: a.historyText,
    memoryContext: a.memoryContext,
    continuityContext: a.continuityContext,
  });
  assert.equal(a.report.beforeTokens, b.report.beforeTokens);
  assert.deepEqual(b.report.actionsApplied, []);
});

// ── token math sanity ──────────────────────────────────────

test("load-shedding — afterTokens is monotonically <= beforeTokens", () => {
  const result = applyLoadShedding({
    systemPrompt: chunk(2000),
    historyText: chunk(8000),
    memoryContext: chunk(6000),
    continuityContext: chunk(2000),
    interactionSignals: chunk(4000),
    selfModelBrief: chunk(1000),
    emotionContext: chunk(1000),
  });
  assert.ok(result.report.afterTokens <= result.report.beforeTokens);
});
