/**
 * HER — Synthetic Self Model (Step 18.X) — pure logic tests.
 *
 * The store / API / prompt wiring all delegate to these pure functions,
 * so if these are right, the rest is just plumbing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEUTRAL_STATE,
  decaySyntheticSelfState,
  updateSyntheticSelfState,
  deriveBehavioralBias,
  buildSelfStateBrief,
  validateSelfState,
  type SyntheticSelfState,
} from "../../src/lib/self-model.js";
import type { InteractionSignal } from "../../src/lib/interaction-signals.js";

const NOW = new Date("2026-05-12T12:00:00Z");

function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3600 * 1000);
}

function clone(s: SyntheticSelfState): SyntheticSelfState {
  return { ...s };
}

function signal(overrides: Partial<InteractionSignal> = {}): InteractionSignal {
  return {
    interactionPattern: "casual",
    engagementTrend: "stable",
    userIntentClarity: "clear",
    responseStyle: "balanced",
    conversationShift: "none",
    confidence: 0.8,
    ...overrides,
  };
}

// ── NEUTRAL_STATE invariants ───────────────────────────────

test("NEUTRAL_STATE — every field is finite and inside its range", () => {
  for (const [k, v] of Object.entries(NEUTRAL_STATE)) {
    assert.ok(Number.isFinite(v), `${k} must be finite`);
    if (k === "trustDrift" || k === "attachmentTrend" || k === "tensionTrend") {
      assert.ok(v >= -1 && v <= 1, `${k} out of [-1,1]: ${v}`);
    } else {
      assert.ok(v >= 0 && v <= 1, `${k} out of [0,1]: ${v}`);
    }
  }
});

test("NEUTRAL_STATE — frozen baseline (mutation throws in strict mode)", () => {
  assert.ok(Object.isFrozen(NEUTRAL_STATE));
});

// ── decaySyntheticSelfState ────────────────────────────────

test("decay — a small gap barely moves the state", () => {
  const start: SyntheticSelfState = { ...NEUTRAL_STATE, tensionTrend: 0.6 };
  const decayed = decaySyntheticSelfState(start, ago(0.1), NOW);
  // <1h gap → rate 0.02. Movement: 0.6 → 0.6 + (0-0.6)*0.02 = 0.588
  assert.ok(Math.abs(decayed.tensionTrend - 0.588) < 1e-9);
});

test("decay — long gap pulls strongly toward neutral", () => {
  const start: SyntheticSelfState = { ...NEUTRAL_STATE, tensionTrend: 0.8 };
  const decayed = decaySyntheticSelfState(start, ago(96), NOW); // >72h → 0.5
  // 0.8 + (0-0.8)*0.5 = 0.4
  assert.ok(Math.abs(decayed.tensionTrend - 0.4) < 1e-9);
});

test("decay — never overshoots neutral", () => {
  const start: SyntheticSelfState = { ...NEUTRAL_STATE, conversationalEnergy: 0.05 };
  const decayed = decaySyntheticSelfState(start, ago(500), NOW);
  // Rate caps at 0.5 — never crosses neutral.
  assert.ok(decayed.conversationalEnergy >= 0.05);
  assert.ok(decayed.conversationalEnergy <= NEUTRAL_STATE.conversationalEnergy);
});

test("decay — values stay within their declared ranges", () => {
  const wild: SyntheticSelfState = {
    conversationalEnergy: 5,        // out of bound
    socialOpenness: -2,             // out of bound
    trustDrift: 10,                 // out of bound
    curiosity: -10,
    emotionalIntensity: 3,
    conversationalStability: 7,
    attachmentTrend: -7,
    tensionTrend: 9,
    unpredictability: 4,
    reflectiveDepth: -3,
  };
  const decayed = decaySyntheticSelfState(wild, ago(10), NOW);
  for (const [k, v] of Object.entries(decayed)) {
    if (k === "trustDrift" || k === "attachmentTrend" || k === "tensionTrend") {
      assert.ok(v >= -1 && v <= 1, `${k} out of range after decay: ${v}`);
    } else {
      assert.ok(v >= 0 && v <= 1, `${k} out of range after decay: ${v}`);
    }
  }
});

// ── updateSyntheticSelfState ───────────────────────────────

test("update — deepening pattern raises openness, attachment, trust", () => {
  const before = clone(NEUTRAL_STATE);
  const after = updateSyntheticSelfState(before, signal({ interactionPattern: "deepening" }), {
    lastUpdated: NOW, now: NOW,
  });
  assert.ok(after.socialOpenness > before.socialOpenness);
  assert.ok(after.attachmentTrend > before.attachmentTrend);
  assert.ok(after.trustDrift > before.trustDrift);
});

test("update — repetitive pattern lowers energy and raises tension", () => {
  const before = clone(NEUTRAL_STATE);
  const after = updateSyntheticSelfState(before, signal({ interactionPattern: "repetitive" }), {
    lastUpdated: NOW, now: NOW,
  });
  assert.ok(after.conversationalEnergy < before.conversationalEnergy);
  assert.ok(after.tensionTrend > before.tensionTrend);
});

test("update — decreasing engagement lowers attachment", () => {
  const before = clone(NEUTRAL_STATE);
  const after = updateSyntheticSelfState(before, signal({ engagementTrend: "decreasing" }), {
    lastUpdated: NOW, now: NOW,
  });
  assert.ok(after.attachmentTrend < before.attachmentTrend);
  assert.ok(after.conversationalEnergy < before.conversationalEnergy);
});

test("update — confidence scales the magnitude of every nudge", () => {
  const a = updateSyntheticSelfState(
    clone(NEUTRAL_STATE),
    signal({ interactionPattern: "deepening", confidence: 0.2 }),
    { lastUpdated: NOW, now: NOW },
  );
  const b = updateSyntheticSelfState(
    clone(NEUTRAL_STATE),
    signal({ interactionPattern: "deepening", confidence: 1.0 }),
    { lastUpdated: NOW, now: NOW },
  );
  assert.ok(
    b.socialOpenness - NEUTRAL_STATE.socialOpenness >
      a.socialOpenness - NEUTRAL_STATE.socialOpenness,
  );
});

test("update — single signal can't push past the natural bounds", () => {
  // Even with confidence=1 and a positive pattern, one signal must not
  // drive a field outside its range.
  let state = clone(NEUTRAL_STATE);
  for (let i = 0; i < 50; i++) {
    state = updateSyntheticSelfState(state, signal({ interactionPattern: "deepening" }), {
      lastUpdated: NOW, now: NOW,
    });
  }
  assert.ok(state.socialOpenness <= 1);
  assert.ok(state.attachmentTrend <= 1);
  assert.ok(state.trustDrift <= 1);
});

test("update — ignoredOutreach raises tension and lowers attachment", () => {
  const before = clone(NEUTRAL_STATE);
  const after = updateSyntheticSelfState(before, signal(), {
    lastUpdated: NOW, now: NOW, ignoredOutreach: true,
  });
  assert.ok(after.attachmentTrend < before.attachmentTrend);
  assert.ok(after.tensionTrend > before.tensionTrend);
});

test("update — applies decay BEFORE nudges (stale tension fades)", () => {
  // Start hot; long silence; one neutral signal. Result should be cooler
  // than the starting tension, even though no negative signal arrived.
  const hot: SyntheticSelfState = { ...NEUTRAL_STATE, tensionTrend: 0.8 };
  const after = updateSyntheticSelfState(hot, signal(), {
    lastUpdated: ago(96),
    now: NOW,
  });
  assert.ok(after.tensionTrend < hot.tensionTrend);
});

// ── deriveBehavioralBias ───────────────────────────────────

test("bias — neutral state produces few or no notes", () => {
  const bias = deriveBehavioralBias(NEUTRAL_STATE);
  assert.ok(bias.notes.length <= 2, `expected ≤2 notes, got ${bias.notes.length}`);
  assert.equal(bias.guarded, false);
  assert.equal(bias.reserved, false);
});

test("bias — high tension marks guarded", () => {
  const bias = deriveBehavioralBias({ ...NEUTRAL_STATE, tensionTrend: 0.5 });
  assert.equal(bias.guarded, true);
  assert.ok(bias.notes.some((n) => /friction/i.test(n)));
});

test("bias — high reflectiveDepth marks reflective", () => {
  const bias = deriveBehavioralBias({ ...NEUTRAL_STATE, reflectiveDepth: 0.85 });
  assert.equal(bias.reflective, true);
});

test("bias — never names emotions", () => {
  const extreme: SyntheticSelfState = {
    conversationalEnergy: 0.1,
    socialOpenness: 0.1,
    trustDrift: -0.9,
    curiosity: 0.95,
    emotionalIntensity: 0.95,
    conversationalStability: 0.1,
    attachmentTrend: -0.9,
    tensionTrend: 0.9,
    unpredictability: 0.95,
    reflectiveDepth: 0.95,
  };
  const bias = deriveBehavioralBias(extreme);
  const flat = bias.notes.join(" ").toLowerCase();
  for (const banned of ["happy", "sad", "angry", "anxious", "lonely", "excited", "frustrated", "feeling", "mood", "emotion"]) {
    assert.ok(!flat.includes(banned), `bias mentioned banned word "${banned}": ${flat}`);
  }
});

// ── buildSelfStateBrief ────────────────────────────────────

test("brief — neutral state may produce no brief at all", () => {
  // We don't require null specifically — depending on rounding, NEUTRAL
  // might produce 0 or 1 weak notes — but if it produces a brief, it must
  // still carry the "do not mention these states" guard.
  const out = buildSelfStateBrief(NEUTRAL_STATE);
  if (out !== null) {
    assert.match(out, /do not name them|never mention these aloud/i);
  }
});

test("brief — distinctive state always carries the never-mention guard", () => {
  const out = buildSelfStateBrief({ ...NEUTRAL_STATE, tensionTrend: 0.6, reflectiveDepth: 0.85 });
  assert.ok(out !== null);
  assert.match(out!, /internal/i);
  assert.match(out!, /do not name them|never mention these aloud/i);
});

test("brief — never contains emotion words", () => {
  const out = buildSelfStateBrief({
    ...NEUTRAL_STATE,
    tensionTrend: 0.7,
    socialOpenness: 0.1,
    attachmentTrend: -0.8,
  });
  assert.ok(out !== null);
  const lower = out!.toLowerCase();
  for (const banned of ["happy", "sad", "angry", "anxious", "lonely", "excited", "frustrated"]) {
    assert.ok(!lower.includes(banned), `brief mentioned banned word "${banned}"`);
  }
});

// ── validateSelfState ──────────────────────────────────────

test("validate — null/garbage degrades to NEUTRAL", () => {
  assert.deepEqual(validateSelfState(null), NEUTRAL_STATE);
  assert.deepEqual(validateSelfState("nonsense"), NEUTRAL_STATE);
  assert.deepEqual(validateSelfState(42), NEUTRAL_STATE);
});

test("validate — partial object fills missing fields from NEUTRAL", () => {
  const out = validateSelfState({ tensionTrend: 0.5 });
  assert.equal(out.tensionTrend, 0.5);
  assert.equal(out.curiosity, NEUTRAL_STATE.curiosity);
});

test("validate — out-of-range values are clamped, not dropped", () => {
  const out = validateSelfState({ tensionTrend: 9, conversationalEnergy: -3 });
  assert.equal(out.tensionTrend, 1);
  assert.equal(out.conversationalEnergy, 0);
});
