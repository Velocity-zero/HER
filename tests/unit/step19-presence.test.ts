import test from "node:test";
import assert from "node:assert/strict";
import {
  decideReplyLengthGoal,
  decideMomentumGoal,
  decideQuestionDiscipline,
  deriveMicroExpression,
  deriveListeningSignal,
  generateConversationalPresencePlan,
  buildPresencePrompt,
} from "../../src/lib/presence";
import { buildSystemPrompt } from "../../src/lib/prompts/index";

test("STEP 19 — Conversational Presence & Emergent Dialogue", () => {
  // 1. Reply length goal
  assert.equal(decideReplyLengthGoal(15, false, false), "very_short");
  assert.equal(decideReplyLengthGoal(50, false, false), "medium");
  assert.equal(decideReplyLengthGoal(200, false, false), "long");
  assert.equal(decideReplyLengthGoal(30, false, true), "long", "Technical topics earn long explanations");

  // 2. Momentum goal selection (one clear goal)
  assert.equal(decideMomentumGoal("anxious"), "comfort");
  assert.equal(decideMomentumGoal("sad"), "comfort");
  assert.equal(decideMomentumGoal("excited"), "celebrate");
  assert.equal(decideMomentumGoal("hopeful"), "encourage");
  assert.equal(decideMomentumGoal(undefined, "building a project goal"), "explore");
  assert.equal(decideMomentumGoal(undefined, "random check in"), "reflect");

  // 3. Question discipline (stopping mechanical trailing questions)
  assert.equal(decideQuestionDiscipline(true, false, 5), false, "Complete beats should NOT trail with a question");
  assert.equal(decideQuestionDiscipline(false, true, 1), true, "Earned curiosity allows questions");
  assert.equal(decideQuestionDiscipline(false, false, 3), true, "Can ask when turns since last question >= 3");

  // 4. Micro expression layer & listening signals
  assert.equal(deriveMicroExpression({ unexpected: true }), "I wasn't expecting that.");
  assert.equal(deriveMicroExpression({ agreement: true }), "Fair.");
  assert.equal(deriveMicroExpression({ realization: true }), "Oh.");
  assert.equal(deriveListeningSignal("the deadline is tomorrow"), "So that's why the deadline mattered.");
  assert.equal(deriveListeningSignal("searching for job"), "That explains why you've been carrying it around.");

  // 5. Conversational Presence Plan generation
  const plan = generateConversationalPresencePlan([{ role: "user", content: "yeah" }]);
  assert.equal(plan.lengthGoal, "very_short");
  assert.equal(plan.shouldUseSilenceOrBrief, true);

  // 6. Presence prompt verification
  const presencePrompt = buildPresencePrompt(plan);
  assert.ok(presencePrompt.includes("CONVERSATIONAL PRESENCE & EMERGENT DIALOGUE"));
  assert.ok(presencePrompt.includes("PRESENCE OVER PERFORMANCE"));
  assert.ok(presencePrompt.includes("QUESTION DISCIPLINE (CRITICAL)"));
  assert.ok(presencePrompt.includes("STOP ending every reply with a question!"));
  assert.ok(presencePrompt.includes("ALLOW SILENCE & BRIEF ACKNOWLEDGMENT"));
  assert.ok(presencePrompt.includes("EMOTIONAL MIRRORING"));
  assert.ok(presencePrompt.includes("LISTENING SIGNALS"));
  assert.ok(presencePrompt.includes("NATURAL CALLBACKS"));

  // 7. System prompt integration check
  const sysPrompt = buildSystemPrompt({ rapportLevel: 2 });
  assert.ok(sysPrompt.includes("CONVERSATIONAL PRESENCE & EMERGENT DIALOGUE"));
  assert.ok(sysPrompt.includes("PRESENCE OVER PERFORMANCE"));
  assert.ok(sysPrompt.includes("QUESTION DISCIPLINE (CRITICAL)"));
});
