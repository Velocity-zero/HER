import test from "node:test";
import assert from "node:assert/strict";
import { parseMemoryExtractionLine } from "../../src/lib/memory";
import {
  NEUTRAL_STATE,
  updateSyntheticSelfState,
  decaySyntheticSelfState,
} from "../../src/lib/self-model";
import { InteractionSignal } from "../../src/lib/interaction-signals";

test("Step 3: Emotional State Continuity & Memory Extraction Parsing Verification", () => {
  // 1. Verify Qwen3-Next-80B memory extraction line parsing
  const parsed1 = parseMemoryExtractionLine("identity|0.95|neutral|0.1: their name is alex");
  assert.ok(parsed1);
  assert.equal(parsed1.category, "identity");
  assert.equal(parsed1.confidence, 0.95);
  assert.equal(parsed1.emotion, "neutral");
  assert.equal(parsed1.intensity, 0.1);
  assert.equal(parsed1.fact, "their name is alex");

  const parsed2 = parseMemoryExtractionLine("context|0.7|anxious|0.7: they have a job interview next week");
  assert.ok(parsed2);
  assert.equal(parsed2.category, "context");
  assert.equal(parsed2.emotion, "anxious");
  assert.equal(parsed2.intensity, 0.7);
  assert.equal(parsed2.fact, "they have a job interview next week");

  const parsedNone = parseMemoryExtractionLine("NONE");
  assert.equal(parsedNone, null);

  // 2. Verify emotional state continuity across a simulated multi-turn interaction
  let state = { ...NEUTRAL_STATE };
  assert.equal(state.socialOpenness, 0.55);
  assert.equal(state.conversationalStability, 0.7);

  // Turn 1: user opens up with a deepening topic
  const deepeningSignal: InteractionSignal = {
    userIntent: "share",
    emotionalTone: "warm",
    conversationalEngagement: "high",
    interactionPattern: "deepening",
    userNeedsSupport: false,
    rapportLevel: "close",
    confidence: 0.9,
    notes: "User shared personal goals",
  };
  state = updateSyntheticSelfState(state, deepeningSignal);
  assert.ok(state.socialOpenness >= NEUTRAL_STATE.socialOpenness);
  assert.ok(state.attachmentTrend >= NEUTRAL_STATE.attachmentTrend);

  // Turn 2: time decay over 24 hours
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  state = decaySyntheticSelfState(state, yesterday, now);
  assert.ok(state.socialOpenness <= 1.0);
  assert.ok(state.socialOpenness >= 0.0);
});
