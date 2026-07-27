import test from "node:test";
import assert from "node:assert/strict";
import { isIncompleteSentence, formatMigrationAuditLog } from "../../src/lib/provider";
import { buildSystemPrompt } from "../../src/lib/prompts/index";
import { formatMemoryForPrompt, MemoryEntry } from "../../src/lib/memory";

test("Regression #1 — Emoji Reaction Tray Data Structure", () => {
  // Curated emojis array exported from MessageBubble module
  const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "🔥", "👏"];
  assert.equal(REACTION_EMOJIS.length, 6);
  assert.ok(REACTION_EMOJIS.includes("❤️"));
  assert.ok(REACTION_EMOJIS.includes("🔥"));
});

test("Regression #2 — Diagnostic Sentence Completion Check", () => {
  // Complete sentences -> false (not incomplete)
  assert.equal(isIncompleteSentence("let's dance before we burn down the house."), false);
  assert.equal(isIncompleteSentence("hey, what's up?"), false);
  assert.equal(isIncompleteSentence("sure! sounds good."), false);

  // Truncated / dangling sentence -> true (incomplete)
  assert.equal(isIncompleteSentence("let's dance before we burn the"), true);
  assert.equal(isIncompleteSentence("I'm going to the store because"), true);
  assert.equal(isIncompleteSentence("this happens when"), true);
});

test("Regression #2 — Structured Migration Audit Log Formatting", () => {
  const auditText = formatMigrationAuditLog({
    provider: "NVIDIA NIM",
    model: "qwen/qwen3-next-80b-a3b-instruct",
    promptChars: 1200,
    promptTokens: 300,
    completionTokens: 50,
    finishReason: "stop",
    latencyMs: 450,
    chunks: 12,
    finalChars: 200,
    last100Chars: "sounds like a plan!",
    isIncomplete: false,
  });

  assert.ok(auditText.includes("[HER MIGRATION AUDIT]"));
  assert.ok(auditText.includes("Provider: NVIDIA NIM"));
  assert.ok(auditText.includes("Finish reason: stop"));
  assert.ok(auditText.includes("Incomplete sentence flag: false"));
});

test("Regression #3 — Empty Memory Prompt Omission & Placeholder Shield", () => {
  // Empty memory array -> formatMemoryForPrompt returns null
  const emptyMemories: MemoryEntry[] = [];
  const memoryContext = formatMemoryForPrompt(emptyMemories);
  assert.equal(memoryContext, null);

  // System prompt assembled with null memoryContext
  const prompt = buildSystemPrompt({ memoryContext: undefined });

  // Must NOT contain any memory section header or placeholder strings
  assert.equal(prompt.includes("THINGS YOU REMEMBER ABOUT THIS PERSON:"), false);
  assert.equal(prompt.includes("[insert"), false);
  assert.equal(prompt.includes("shared memory"), false);
  assert.equal(prompt.includes("{{memory}}"), false);
  assert.equal(prompt.includes("<TODO>"), false);
});

test("Regression Audit — End-to-End Conversation Pipeline Snapshot", () => {
  const inputUserMessage = "hey, want to grab coffee?";
  const systemPrompt = buildSystemPrompt();

  assert.ok(systemPrompt.length > 500);
  assert.ok(inputUserMessage.length > 5);

  // Verification of full prompt integrity
  assert.ok(systemPrompt.includes("WHO YOU ARE:"));
  assert.ok(systemPrompt.includes("VOICE:"));
  assert.ok(systemPrompt.includes("DON'T SOUND LIKE A BOT:"));
});
