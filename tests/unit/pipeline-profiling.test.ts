/**
 * HER — Step 18.2 — Phase A pure-utility tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createTrace } from "../../src/lib/trace.js";
import { withTimeout } from "../../src/lib/with-timeout.js";
import { classifyFailure } from "../../src/lib/failure-classify.js";
import {
  detectRecursiveMarkers,
  auditContextPayloads,
  RECURSION_MARKERS,
} from "../../src/lib/recursive-context-detector.js";
import {
  estimateTokens,
  auditContext,
  reportToLog,
  TOKEN_BUDGET,
} from "../../src/lib/context-budget.js";

// ── trace ──────────────────────────────────────────────────

test("trace — produces an 8-char traceId and end() returns a number", () => {
  const t = createTrace();
  assert.equal(t.traceId.length, 8);
  // .stage() should not throw and should not return anything
  t.stage("x", { a: 1 });
  const total = t.end();
  assert.equal(typeof total, "number");
  assert.ok(total >= 0);
});

// ── withTimeout ────────────────────────────────────────────

test("withTimeout — resolves when promise wins", async () => {
  const result = await withTimeout(Promise.resolve("ok"), {
    label: "fast",
    ms: 100,
    fallback: "fallback",
  });
  assert.equal(result, "ok");
});

test("withTimeout — returns fallback when promise stalls", async () => {
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200));
  const result = await withTimeout(slow, {
    label: "slow",
    ms: 20,
    fallback: "fallback",
  });
  assert.equal(result, "fallback");
});

test("withTimeout — returns fallback when promise rejects", async () => {
  const result = await withTimeout(Promise.reject(new Error("boom")), {
    label: "bad",
    ms: 50,
    fallback: "ok",
  });
  assert.equal(result, "ok");
});

// ── classifyFailure ────────────────────────────────────────

test("classify — 429 → HER_PROVIDER_RATE", () => {
  const c = classifyFailure(new Error("429 Too Many Requests"));
  assert.equal(c.code, "HER_PROVIDER_RATE");
  assert.equal(c.status, 429);
});

test("classify — NVIDIA 5xx → HER_PROVIDER_ERROR", () => {
  const c = classifyFailure(new Error("NVIDIA API error (502)"));
  assert.equal(c.code, "HER_PROVIDER_ERROR");
  assert.equal(c.status, 502);
});

test("classify — generic timeout → HER_TIMEOUT", () => {
  const c = classifyFailure(new Error("operation timed out"));
  assert.equal(c.code, "HER_TIMEOUT");
});

test("classify — supabase timeout → HER_DB_TIMEOUT", () => {
  const c = classifyFailure(new Error("supabase connection timed out"));
  assert.equal(c.code, "HER_DB_TIMEOUT");
});

test("classify — context length error → HER_CONTEXT_LIMIT", () => {
  const c = classifyFailure(new Error("Maximum context length exceeded"));
  assert.equal(c.code, "HER_CONTEXT_LIMIT");
});

test("classify — malformed JSON → HER_DATA_CORRUPTION", () => {
  const c = classifyFailure(new Error("Unexpected token < in JSON at position 0"));
  assert.equal(c.code, "HER_DATA_CORRUPTION");
});

test("classify — unknown → HER_UNKNOWN, kind user message", () => {
  const c = classifyFailure(new Error("totally novel failure"));
  assert.equal(c.code, "HER_UNKNOWN");
  assert.match(c.userMessage, /broke on my end/i);
});

// ── recursive context detector ─────────────────────────────

test("recursion — clean payload returns no findings", () => {
  const findings = detectRecursiveMarkers("memory", "she likes long walks and rainy mornings.");
  assert.deepEqual(findings, []);
});

test("recursion — embedded self-state brief is detected", () => {
  const dirty = "user note: ... CURRENT CONVERSATIONAL TENDENCIES (internal — never mention these aloud): ...";
  const findings = detectRecursiveMarkers("memory", dirty);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].source, "memory");
  assert.ok(RECURSION_MARKERS.includes(findings[0].marker as typeof RECURSION_MARKERS[number]));
});

test("recursion — null/undefined payloads are safe", () => {
  assert.deepEqual(detectRecursiveMarkers("x", null), []);
  assert.deepEqual(detectRecursiveMarkers("x", undefined), []);
  assert.deepEqual(detectRecursiveMarkers("x", ""), []);
});

test("recursion — auditContextPayloads scans every label", () => {
  const out = auditContextPayloads({
    memory: "fine",
    continuity: "ok ... PERSONALITY ANCHOR ...",
    signals: null,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "continuity");
});

// ── context budget ─────────────────────────────────────────

test("estimateTokens — char/4 ceiling, null-safe", () => {
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2); // ceil(5/4)
});

test("audit — sums every layer and flags overage", () => {
  const big = "x".repeat(TOKEN_BUDGET.memory * 4 + 100); // > memory budget
  const r = auditContext({
    systemPrompt: "sys",
    historyText: "hi",
    memoryContext: big,
  });
  assert.equal(r.systemPromptChars, 3);
  assert.equal(r.historyChars, 2);
  assert.equal(r.memoryChars, big.length);
  assert.equal(r.totalChars, 3 + 2 + big.length);
  assert.ok(r.overBudgetLayers.includes("memory"));
});

test("audit — overTotalBudget flips when ceiling crossed", () => {
  const giant = "x".repeat(TOKEN_BUDGET.total * 4 + 1000);
  const r = auditContext({ systemPrompt: giant });
  assert.equal(r.overTotalBudget, true);
});

test("reportToLog — omits empty overage fields", () => {
  const r = auditContext({ systemPrompt: "hi", historyText: "there" });
  const log = reportToLog(r);
  assert.equal(log.overBudget, undefined);
  assert.equal(log.overTotal, undefined);
  assert.equal(log.totalChars, "hi".length + "there".length);
});
