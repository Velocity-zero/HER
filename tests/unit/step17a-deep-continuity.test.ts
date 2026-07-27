import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../src/lib/prompts/index";
import { formatMemoryForPrompt, MemoryEntry } from "../../src/lib/memory";

test("STEP 17A — Deep Conversational Continuity & Context-Aware Scene Construction", () => {
  // 1. Verify formatMemoryForPrompt priority sorting (active context & life threads first)
  const mockMemories: MemoryEntry[] = [
    { user_id: "u1", fact: "enjoys dark chocolate", category: "preference", confidence: 0.9 },
    { user_id: "u1", fact: "left internship and figuring out what's next", category: "context", confidence: 0.95, emotion: "anxious", intensity: 0.8 },
    { user_id: "u1", fact: "rebuilding HER application codebase", category: "life", confidence: 0.9, emotion: "excited", intensity: 0.7 },
    { user_id: "u1", fact: "name is Alex", category: "identity", confidence: 0.99 },
  ];

  const formatted = formatMemoryForPrompt(mockMemories);
  assert.ok(formatted !== null);
  // Context and life facts must come before preference
  const lines = formatted.split("\n");
  assert.ok(lines[0].includes("left internship"));
  assert.ok(lines[1].includes("rebuilding HER"));
  assert.ok(lines[0].includes("(this seemed to worry them)"));

  // 2. Verify System Prompt contains Scene Construction, Emotional Trajectory & Implicit Memory Weighting
  const prompt = buildSystemPrompt({
    mode: "default",
    memoryContext: formatted,
    rapportLevel: 2,
  });

  // Check Core Principles present in System Prompt
  assert.ok(prompt.includes("INTERNAL REFLECTION & NARRATIVE REASONING"));
  assert.ok(prompt.includes("SCENE CONSTRUCTION"));
  assert.ok(prompt.includes("SHOW, DON'T TELL"));
  assert.ok(prompt.includes("IMPLICIT MEMORY WEAVING"));
  assert.ok(prompt.includes("LONG-TERM THREADS"));
  assert.ok(prompt.includes("RELATIONSHIP CONTINUITY"));
  assert.ok(prompt.includes("DON'T SOUND LIKE A BOT:"));
  assert.ok(prompt.includes("LENGTH & PACING"));
  assert.ok(prompt.includes("SHARED HISTORY & PERSISTENT MEMORY"));
  assert.ok(prompt.includes("Weighting: Current message > Recent chat > Memories > Emotional state > Relationship history"));
});
