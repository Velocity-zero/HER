import test from "node:test";
import assert from "node:assert/strict";
import { computePipelineHash, logPipelineStage } from "../../src/lib/pipeline-logger";

test("Pipeline Diagnostic Stage Logger — Deterministic Hashing & Character Metrics", () => {
  const sampleReply = "let's dance before we burn down the house. sounds like a plan!";
  const hash1 = computePipelineHash(sampleReply);
  const hash2 = computePipelineHash(sampleReply);

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 8);

  const stageLog = logPipelineStage("Provider", sampleReply);
  assert.equal(stageLog.stage, "Provider");
  assert.equal(stageLog.character_count, sampleReply.length);
  assert.equal(stageLog.word_count, 12);
  assert.equal(stageLog.hash, hash1);
});

test("Pipeline Diagnostic Stage Logger — Mutation Detection via Hash Divergence", () => {
  const originalReply = "let's dance before we burn down the house.";
  const mutatedReply = "let's dance before we burn down the house. "; // trailing space added by renderer/editor

  const hashOriginal = computePipelineHash(originalReply);
  const hashMutated = computePipelineHash(mutatedReply);

  // Hash must change if any character or trailing whitespace is altered
  assert.notEqual(hashOriginal, hashMutated);
});
