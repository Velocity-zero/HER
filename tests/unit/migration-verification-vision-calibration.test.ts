import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisionRefinementMessages,
  isSubjectiveVisionQuestion,
  generateDynamicVisionFallback,
  generateSoftError,
} from "../../src/lib/multimodal";
import { NVIDIA_CHAT_MODEL, DEFAULT_NVIDIA_CHAT_MODEL } from "../../src/lib/providers/NvidiaProvider";

test("Step 2: Multimodal Vision Voice Calibration — Confirms Model Integration", async () => {
  // 1. Ensure active model is used by multimodal.ts for vision rewrites
  assert.equal(NVIDIA_CHAT_MODEL, DEFAULT_NVIDIA_CHAT_MODEL);

  // 2. Test subjective vs objective vision question classification
  assert.equal(isSubjectiveVisionQuestion("how do i look in this outfit?"), true);
  assert.equal(isSubjectiveVisionQuestion("what vibe does this photo give?"), true);
  assert.equal(isSubjectiveVisionQuestion("what is written on the whiteboard?"), false);
  assert.equal(isSubjectiveVisionQuestion("how many cars are parked outside?"), false);

  // 3. Test vision refinement prompt assembly for Qwen3-Next-80B
  const rawGemmaAnalysis = "A person standing in front of a mirror wearing a navy blue sweater and dark denim jeans. Lighting is warm indoor lamp light.";
  const refinementMessages = buildVisionRefinementMessages("how do I look?", rawGemmaAnalysis);

  assert.equal(refinementMessages.length, 2);
  assert.equal(refinementMessages[0].role, "system");
  assert.equal(refinementMessages[1].role, "user");
  assert.ok(refinementMessages[0].content.includes("You're a close friend looking at a photo someone shared with you"));
  assert.ok(refinementMessages[1].content.includes(rawGemmaAnalysis));
  assert.ok(refinementMessages[1].content.includes("Don't repeat the raw analysis — just give your natural response"));

  // 4. Test dynamic fallback generation for subjective questions
  const fallbackText = await generateDynamicVisionFallback("how do I look?");
  assert.ok(fallbackText.length > 10, `Fallback text should be non-empty and descriptive: ${fallbackText}`);
  assert.equal(fallbackText.toLowerCase().includes("gemma"), false); // Never leaks technical vision model name

  // 5. Test soft error formatting
  const softErr = await generateSoftError(new Error("429 Too Many Requests"), "how do I look?");
  assert.ok(softErr.length > 5, `Soft error text should be non-empty: ${softErr}`);
  assert.ok(!softErr.includes("429") && !softErr.includes("Error"));
});
