import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, CONTEXT_CONFIG } from "../../src/lib/context";
import { NVIDIA_CHAT_MODEL, formatMigrationAuditLog, isIncompleteSentence } from "../../src/lib/provider";
import { computePipelineHash } from "../../src/lib/pipeline-logger";
import { Message } from "../../src/lib/types";

test("Step 1: Real-World Production Truncation & Deep History Verification (35 Turns)", () => {
  // 1. Generate 35 turns of realistic conversation history (> recentMessageCount of 30)
  const longHistory: Message[] = Array.from({ length: 35 }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: i % 2 === 0
      ? `This is user message turn ${i}. We are discussing complex project architectures and emotional resilience.`
      : `I hear you on turn ${i}. It is completely natural to feel overwhelmed when building large-scale systems. Take a breath and focus on one module at a time.`,
    createdAt: new Date(Date.now() - (35 - i) * 60000).toISOString(),
  }));

  // 2. Build the context window for Qwen3-Next-80B-A3B-Instruct
  const contextMessages = buildContext(longHistory, { mode: "default" });

  // 3. Verify that the system prompt is first and recent message window is bounded by CONTEXT_CONFIG
  assert.equal(contextMessages[0].role, "system");
  assert.ok(contextMessages.length <= CONTEXT_CONFIG.recentMessageCount + 2); // system + summary + window

  // 4. Verify that total characters remain within safe prompt token limits
  const totalChars = contextMessages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  assert.ok(totalChars < 25_000, `Total characters (${totalChars}) should remain safe for Qwen3-Next-80B context window`);

  // 5. Verify Qwen3-Next-80B audit log formatting and completeness flag for a long 2048-token budgeted reply
  const simulatedReply = "We've been looking at this project since turn 0, and every single time you step back, the structure becomes clearer. You've already solved the hardest database and streaming challenges—trust the work you've put in.";
  const auditText = formatMigrationAuditLog({
    provider: "NVIDIA NIM",
    model: NVIDIA_CHAT_MODEL,
    promptChars: totalChars,
    promptTokens: Math.ceil(totalChars / 4),
    completionTokens: 45,
    finishReason: "stop",
    latencyMs: 540,
    chunks: 20,
    chunksExpected: 20,
    finalChars: simulatedReply.length,
    last100Chars: simulatedReply.slice(-100),
    isIncomplete: isIncompleteSentence(simulatedReply),
  });

  assert.ok(auditText.includes(NVIDIA_CHAT_MODEL));
  assert.ok(auditText.includes("Finish reason: stop"));
  assert.ok(auditText.includes("SSE Chunks Received: 20"));
  assert.ok(auditText.includes("SSE Chunks Expected: 20"));
  assert.ok(auditText.includes("Incomplete sentence flag: false"));

  // 6. Verify pipeline hash consistency
  const hash1 = computePipelineHash(simulatedReply);
  const hash2 = computePipelineHash(simulatedReply);
  assert.equal(hash1, hash2);
});
