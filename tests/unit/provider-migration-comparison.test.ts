import test from "node:test";
import assert from "node:assert/strict";
import { runProviderComparison } from "../../scripts/provider-migration-comparison";
import { NVIDIA_CHAT_MODEL } from "../../src/lib/provider";

test("Provider Migration — Confirms Qwen3-Next-80B-A3B-Instruct is Active", () => {
  assert.equal(NVIDIA_CHAT_MODEL, "qwen/qwen3-next-80b-a3b-instruct");
});

test("Provider Migration Comparison Suite — Verifies 10 Benchmark Scenarios", () => {
  const comp = runProviderComparison();
  assert.equal(comp.oldResults.length, 10);
  assert.equal(comp.newResults.length, 10);

  // Qwen3-Next-80B must have 100% sentence completeness and streaming stability across benchmarks
  assert.equal(comp.summary.new.sentenceCompletePct, 100);
  assert.equal(comp.summary.new.streamingStabilityPct, 100);
  assert.equal(comp.summary.new.stopReasonPct, 100);

  // Ensure latency improvement or parity
  assert.ok(comp.summary.new.avgLatencyMs <= comp.summary.old.avgLatencyMs);
});
