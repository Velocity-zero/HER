import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateNarrativeScore,
  rankNarrativeMemories,
  groupMemoriesIntoStories,
  formatMemoryForPrompt,
  MemoryEntry,
  DEFAULT_NARRATIVE_WEIGHTS,
} from "../../src/lib/memory";
import { buildSystemPrompt } from "../../src/lib/prompts/index";

test("STEP 17B — Narrative Memory Retrieval & Human-Like Internal Reflection", () => {
  const mockMemories: MemoryEntry[] = [
    {
      id: "1",
      user_id: "u1",
      fact: "started internship at a tech firm",
      category: "life",
      confidence: 0.95,
      emotion: "excited",
      intensity: 0.8,
    },
    {
      id: "2",
      user_id: "u1",
      fact: "internship offer disappointed him",
      category: "context",
      confidence: 0.9,
      emotion: "frustrated",
      intensity: 0.7,
    },
    {
      id: "3",
      user_id: "u1",
      fact: "left company and searching for better opportunities",
      category: "context",
      confidence: 0.92,
      emotion: "anxious",
      intensity: 0.9,
    },
    {
      id: "4",
      user_id: "u1",
      fact: "currently building HER application",
      category: "life",
      confidence: 0.99,
      emotion: "excited",
      intensity: 0.9,
    },
    {
      id: "5",
      user_id: "u1",
      fact: "low confidence random guess",
      category: "topic",
      confidence: 0.4,
    },
  ];

  // 1. Verify Narrative Weights default dimensions
  assert.equal(DEFAULT_NARRATIVE_WEIGHTS.topicRelevance, 5);
  assert.equal(DEFAULT_NARRATIVE_WEIGHTS.emotionalRelevance, 5);
  assert.equal(DEFAULT_NARRATIVE_WEIGHTS.unfinishedStory, 5);
  assert.equal(DEFAULT_NARRATIVE_WEIGHTS.recentConversation, 4);

  // 2. Verify calculateNarrativeScore & confidence filtering (< 0.6 ignored)
  const ranked = rankNarrativeMemories(mockMemories, { topic: "building her", emotion: "excited" });
  assert.ok(ranked.length === 4, "Should filter out low confidence (<0.6) item");
  assert.ok(
    ranked[0].fact.includes("building HER") || ranked[0].fact.includes("left company"),
    "Top ranked memory should match active context/unfinished story"
  );

  // 3. Verify groupMemoriesIntoStories
  const stories = groupMemoriesIntoStories(ranked);
  const careerStory = stories.find((s) => s.storyName === "Career & Ambition");
  const herStory = stories.find((s) => s.storyName === "HER Development");
  assert.ok(careerStory !== undefined, "Should group career-related memories into Career & Ambition");
  assert.ok(herStory !== undefined, "Should group HER-related memories into HER Development");
  assert.equal(careerStory?.memories.length, 3, "Career story should contain 3 internship/company memories");

  // 4. Verify formatMemoryForPrompt builds coherent story threads (with arrows ->)
  const formatted = formatMemoryForPrompt(mockMemories, { topic: "career internship" });
  assert.ok(formatted !== null);
  assert.ok(formatted.includes("[Career & Ambition]"), "Should format story header");
  assert.ok(formatted.includes("→"), "Should chain multiple memories in story thread chronologically/logically");

  // 5. Verify buildSystemPrompt includes Narrative Reflection & Memory Compression directives
  const prompt = buildSystemPrompt({
    mode: "default",
    memoryContext: formatted,
    rapportLevel: 2,
  });

  assert.ok(prompt.includes("INTERNAL REFLECTION & NARRATIVE REASONING"));
  assert.ok(prompt.includes("Before responding, internally synthesize:"));
  assert.ok(prompt.includes("MEMORY COMPRESSION & ASSOCIATIVE WEAVING"));
  assert.ok(prompt.includes("NEVER dump five memories"));
  assert.ok(prompt.includes("ASSOCIATIVE MEMORY:"));
  assert.ok(prompt.includes("LONG-TERM GOALS:"));
  assert.ok(prompt.includes("SHARED HISTORY & PERSISTENT MEMORY"));
});
