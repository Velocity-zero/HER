import test from "node:test";
import assert from "node:assert/strict";
import {
  decayAttention,
  deriveRelationshipFamiliarity,
  extractAttentionFromMemories,
  extractOpenLoopsFromMemories,
  deriveConversationalEnergy,
  deriveConversationRhythm,
  trackEmotionalMomentum,
  computeInternalMindState,
  buildInternalMindPrompt,
  type AttentionTopic,
} from "../../src/lib/internal-mind";
import { buildSystemPrompt } from "../../src/lib/prompts/index";

test("STEP 18 — HER Internal Mind & Relationship State Engine", () => {
  // 1. Attention Decay
  const topics: AttentionTopic[] = [
    { topic: "Career & Work", weight: 0.9 },
    { topic: "HER development", weight: 0.95 },
  ];
  const decayed = decayAttention(topics, 7);
  assert.equal(decayed.length, 2);
  assert.ok(decayed[0].weight < 0.95, "Weight should decay over time when not repeatedly discussed");
  assert.ok(decayed[0].weight >= decayed[1].weight, "Should sort descending by weight");

  // 2. Relationship Familiarity
  assert.equal(deriveRelationshipFamiliarity(0, 0), "New");
  assert.equal(deriveRelationshipFamiliarity(1, 2), "Comfortable");
  assert.equal(deriveRelationshipFamiliarity(2, 5), "Established");
  assert.equal(deriveRelationshipFamiliarity(3, 10), "Deep");

  // 3. Extract Attention & Open Loops from Memories
  const mockMemories = [
    { fact: "searching for job internship opportunity", category: "context" },
    { fact: "building HER codebase project", category: "life" },
    { fact: "reading white nights book", category: "life" },
  ];
  const attention = extractAttentionFromMemories(mockMemories);
  assert.ok(attention.some((a) => a.topic.includes("Career") || a.topic.includes("Work")));
  assert.ok(attention.some((a) => a.topic.includes("HER development")));

  const openLoops = extractOpenLoopsFromMemories(mockMemories);
  assert.ok(openLoops.some((l) => l.topic === "Job search"));
  assert.ok(openLoops.some((l) => l.topic === "Building HER"));
  assert.ok(openLoops.some((l) => l.topic === "Reading a book"));

  // 4. Conversational Energy
  assert.equal(deriveConversationalEnergy(["excited"], 1), "Excited");
  assert.equal(deriveConversationalEnergy(["anxious"], 1), "Supportive");
  assert.equal(deriveConversationalEnergy(["sad"], 1), "Quiet");
  assert.equal(deriveConversationalEnergy(["frustrated"], 1), "Focused");
  assert.equal(deriveConversationalEnergy([], 2), "Reflective");
  assert.equal(deriveConversationalEnergy([], 0), "Playful");

  // 5. Conversation Rhythm & Emotional Momentum
  const rhythm = deriveConversationRhythm([{ fact: "likes to joke and laugh before serious topics" }]);
  assert.ok(rhythm.some((r) => r.preference.includes("jokes before serious topics")));

  const momentum = trackEmotionalMomentum(["anxious", "hopeful", "excited"]);
  assert.ok(momentum.progression.length >= 2);
  assert.equal(momentum.progression[0], "Discouraged");
  assert.equal(momentum.progression[1], "Motivated");
  assert.equal(momentum.progression[2], "Confident");

  // 6. Complete Mind State & Prompt Assembly
  const mindState = computeInternalMindState([], 2, "- [Career & Work] searching for job\n- [HER development] building her");
  const mindPrompt = buildInternalMindPrompt(mindState);

  assert.ok(mindPrompt.includes("HER INTERNAL MIND & RELATIONSHIP STATE ENGINE"));
  assert.ok(mindPrompt.includes("CURRENT CONVERSATIONAL ENERGY:"));
  assert.ok(mindPrompt.includes("RELATIONSHIP FAMILIARITY:"));
  assert.ok(mindPrompt.includes("ATTENTION MODEL"));
  assert.ok(mindPrompt.includes("OPEN LOOPS"));
  assert.ok(mindPrompt.includes("CONVERSATION RHYTHM"));
  assert.ok(mindPrompt.includes("EMOTIONAL MOMENTUM:"));
  assert.ok(mindPrompt.includes("BEFORE GENERATING A REPLY, INTERNALLY PLAN (SILENT — NEVER SHOW OR EXPOSE TO USER):"));
  assert.ok(mindPrompt.includes("1. Current topic → 2. Current emotion → 3. Relationship familiarity → 4. Relevant memories → 5. Open loops → 6. Current attention → 7. Desired tone → 8. Response goal → 9. Generate reply"));

  // 7. Verification that buildSystemPrompt includes the Internal Mind layer automatically
  const sysPrompt = buildSystemPrompt({ rapportLevel: 2 });
  assert.ok(sysPrompt.includes("HER INTERNAL MIND & RELATIONSHIP STATE ENGINE"));
  assert.ok(sysPrompt.includes("NEVER expose internal state"));
});
