/**
 * HER — Synthetic Self Model (Step 18.X)
 *
 * Pure deterministic library for HER's evolving internal "self".
 *
 * What this is:
 *   A small bounded vector of internal signals — conversational energy,
 *   social openness, trust drift, curiosity, etc. — that evolves slowly
 *   in response to behavioral signals, decays toward neutral over time,
 *   and conditions her tone via a compact "behavioral tendencies" brief.
 *
 * What this is NOT:
 *   - Emotion labels. We never store or expose words like happy, sad, etc.
 *   - A scripted state machine. There are no fixed pathways.
 *   - A user-visible thing. Raw values stay internal; only the brief leaks
 *     out, and only as soft steering, never as a status report.
 *
 * Hard rules (preserved across the layer):
 *   - All values are clamped to their natural ranges.
 *   - All updates pass through gentle deltas, never jumps.
 *   - All values decay toward NEUTRAL on every update tick.
 *   - The derived brief never names emotions and never says "I feel X".
 *   - This file has zero side effects: no DB, no fetch, no Date.now reads
 *     unless an explicit `now` is passed in.
 *
 * Why this design:
 *   The whole layer must remain interpretable, reversible, and bounded.
 *   Without decay, tension accumulates forever and HER calcifies. Without
 *   clamps, a single anomalous signal could push her into a dead state.
 *   Without purity, this becomes impossible to test and to reason about.
 */

import type {
  InteractionSignal,
  InteractionPattern,
  EngagementTrend,
  ResponseStyle,
  ConversationShift,
} from "./interaction-signals";

// ── Types ──────────────────────────────────────────────────

/**
 * The full internal vector. Every field is bounded; the comments document
 * the natural range. We deliberately keep this small — more dimensions
 * would just add noise, not richness.
 */
export interface SyntheticSelfState {
  /** 0..1 — how energetic her replies feel. Low = shorter, slower. */
  conversationalEnergy: number;
  /** 0..1 — how willing she is to go deeper or share. */
  socialOpenness: number;
  /** -1..1 — drift in how reliable the user feels over time. */
  trustDrift: number;
  /** 0..1 — appetite for asking questions / exploring. */
  curiosity: number;
  /** 0..1 — strength of internal reaction to recent turns. */
  emotionalIntensity: number;
  /** 0..1 — steadiness of her cadence (low = uncertain pacing). */
  conversationalStability: number;
  /** -1..1 — drift in attachment to this conversation/user. */
  attachmentTrend: number;
  /** -1..1 — drift in latent tension with this user. */
  tensionTrend: number;
  /** 0..1 — taste for spontaneous, off-pattern moves. */
  unpredictability: number;
  /** 0..1 — pull toward introspective, philosophical tone. */
  reflectiveDepth: number;
}

/**
 * The neutral baseline. Decay always pulls toward this, so HER returns to
 * her natural midpoint when nothing's happening — neither saintly nor sour.
 */
export const NEUTRAL_STATE: SyntheticSelfState = Object.freeze({
  conversationalEnergy: 0.55,
  socialOpenness: 0.55,
  trustDrift: 0,
  curiosity: 0.6,
  emotionalIntensity: 0.4,
  conversationalStability: 0.7,
  attachmentTrend: 0,
  tensionTrend: 0,
  unpredictability: 0.4,
  reflectiveDepth: 0.45,
});

// Per-field min/max so clamping stays honest to each axis.
const RANGES: Record<keyof SyntheticSelfState, [number, number]> = {
  conversationalEnergy:   [0, 1],
  socialOpenness:         [0, 1],
  trustDrift:             [-1, 1],
  curiosity:              [0, 1],
  emotionalIntensity:     [0, 1],
  conversationalStability:[0, 1],
  attachmentTrend:        [-1, 1],
  tensionTrend:           [-1, 1],
  unpredictability:       [0, 1],
  reflectiveDepth:        [0, 1],
};

// ── Internal helpers ───────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pull every field one step toward NEUTRAL. */
function decayTowardNeutral(
  state: SyntheticSelfState,
  rate: number,
): SyntheticSelfState {
  const r = clamp(rate, 0, 1);
  const out = { ...state };
  for (const key of Object.keys(NEUTRAL_STATE) as (keyof SyntheticSelfState)[]) {
    const [min, max] = RANGES[key];
    out[key] = clamp(lerp(state[key], NEUTRAL_STATE[key], r), min, max);
  }
  return out;
}

/** Apply a single field delta with clamping. */
function bump<K extends keyof SyntheticSelfState>(
  state: SyntheticSelfState,
  key: K,
  delta: number,
): void {
  const [min, max] = RANGES[key];
  state[key] = clamp(state[key] + delta, min, max);
}

// ── Public API ─────────────────────────────────────────────

/**
 * Time-based decay. Call this when loading a stored state — the longer
 * the gap since `lastUpdated`, the more we slide back toward neutral.
 *
 * Curve:
 *   < 1h     → barely any decay (0.02)
 *   ~6h      → mild (0.10)
 *   ~24h     → noticeable (0.25)
 *   > 72h    → strong (0.50) — long silence resets the relational stance
 *
 * The cap of 0.5 means even after weeks she never fully erases — just
 * relaxes. Identity persists; reactivity decays.
 */
export function decaySyntheticSelfState(
  state: SyntheticSelfState,
  lastUpdated: Date,
  now: Date = new Date(),
): SyntheticSelfState {
  const hours = Math.max(0, (now.getTime() - lastUpdated.getTime()) / 3_600_000);
  let rate: number;
  if (hours < 1) rate = 0.02;
  else if (hours < 6) rate = 0.10;
  else if (hours < 24) rate = 0.25;
  else if (hours < 72) rate = 0.40;
  else rate = 0.50;
  return decayTowardNeutral(state, rate);
}

/**
 * Update self-state from a single behavioral signal.
 *
 * Design:
 *   - Each signal axis nudges only a few fields, by small amounts (≤0.08).
 *   - Confidence scales every delta — a 0.3-confidence signal barely moves
 *     anything, a 0.9-confidence one moves more, but never violently.
 *   - We always decay first, so a long-quiet user can't be greeted with
 *     stale resentment from a fight three days ago.
 *
 * The mappings are deliberately soft and overlapping — no signal is a
 * "command", they're all just gentle pushes on a fluid vector.
 */
export function updateSyntheticSelfState(
  prev: SyntheticSelfState,
  signal: InteractionSignal,
  options: { lastUpdated?: Date; now?: Date; ignoredOutreach?: boolean } = {},
): SyntheticSelfState {
  const now = options.now ?? new Date();
  const lastUpdated = options.lastUpdated ?? now;

  // Always decay first — fresh state, then apply nudges.
  const decayed = decaySyntheticSelfState(prev, lastUpdated, now);
  const next = { ...decayed };

  // Confidence scales how strongly the signal moves anything.
  // A small floor (0.2) means even a low-confidence signal can leave a
  // faint trace — silence shouldn't be the only thing that moves her.
  const w = clamp(0.2 + signal.confidence * 0.8, 0.2, 1.0);

  // ── interactionPattern ──
  applyPattern(next, signal.interactionPattern, w);

  // ── engagementTrend ──
  applyTrend(next, signal.engagementTrend, w);

  // ── responseStyle ──
  applyStyle(next, signal.responseStyle, w);

  // ── conversationShift ──
  applyShift(next, signal.conversationShift, w);

  // ── userIntentClarity ──
  // Unclear/shifting intent slightly reduces stability — she hesitates a bit.
  if (signal.userIntentClarity === "unclear") {
    bump(next, "conversationalStability", -0.04 * w);
    bump(next, "curiosity", 0.02 * w);
  } else if (signal.userIntentClarity === "shifting") {
    bump(next, "conversationalStability", -0.02 * w);
    bump(next, "unpredictability", 0.02 * w);
  } else if (signal.userIntentClarity === "clear") {
    bump(next, "conversationalStability", 0.02 * w);
  }

  // ── ignored outreach (optional, from caller) ──
  // If a recent spontaneous outreach was ignored, slightly cool attachment
  // and add tension. Bounded — three ignored outreaches won't push to -1.
  if (options.ignoredOutreach) {
    bump(next, "attachmentTrend", -0.05);
    bump(next, "tensionTrend", 0.04);
    bump(next, "socialOpenness", -0.03);
  }

  return next;
}

function applyPattern(
  s: SyntheticSelfState,
  pattern: InteractionPattern,
  w: number,
): void {
  switch (pattern) {
    case "repetitive":
      // The user keeps circling — her energy dips, tension creeps up.
      bump(s, "conversationalEnergy", -0.05 * w);
      bump(s, "tensionTrend", 0.03 * w);
      bump(s, "curiosity", -0.02 * w);
      break;
    case "exploratory":
      bump(s, "curiosity", 0.06 * w);
      bump(s, "socialOpenness", 0.03 * w);
      bump(s, "conversationalEnergy", 0.02 * w);
      break;
    case "goal_oriented":
      bump(s, "conversationalStability", 0.04 * w);
      bump(s, "reflectiveDepth", -0.02 * w);
      break;
    case "uncertain":
      bump(s, "socialOpenness", 0.03 * w);
      bump(s, "reflectiveDepth", 0.03 * w);
      bump(s, "conversationalStability", -0.02 * w);
      break;
    case "multi_topic":
      bump(s, "unpredictability", 0.04 * w);
      bump(s, "conversationalStability", -0.03 * w);
      break;
    case "deepening":
      // The single most relationship-positive pattern.
      bump(s, "socialOpenness", 0.05 * w);
      bump(s, "reflectiveDepth", 0.05 * w);
      bump(s, "attachmentTrend", 0.04 * w);
      bump(s, "trustDrift", 0.03 * w);
      break;
    case "casual":
      bump(s, "conversationalEnergy", 0.02 * w);
      bump(s, "unpredictability", 0.02 * w);
      break;
  }
}

function applyTrend(
  s: SyntheticSelfState,
  trend: EngagementTrend,
  w: number,
): void {
  switch (trend) {
    case "increasing":
      bump(s, "conversationalEnergy", 0.05 * w);
      bump(s, "attachmentTrend", 0.03 * w);
      bump(s, "socialOpenness", 0.02 * w);
      break;
    case "decreasing":
      bump(s, "conversationalEnergy", -0.05 * w);
      bump(s, "attachmentTrend", -0.03 * w);
      bump(s, "emotionalIntensity", -0.02 * w);
      break;
    case "fluctuating":
      bump(s, "conversationalStability", -0.04 * w);
      bump(s, "unpredictability", 0.03 * w);
      break;
    case "stable":
      bump(s, "conversationalStability", 0.03 * w);
      break;
  }
}

function applyStyle(
  s: SyntheticSelfState,
  style: ResponseStyle,
  w: number,
): void {
  switch (style) {
    case "playful":
      bump(s, "unpredictability", 0.04 * w);
      bump(s, "conversationalEnergy", 0.03 * w);
      break;
    case "serious":
      bump(s, "reflectiveDepth", 0.04 * w);
      bump(s, "unpredictability", -0.02 * w);
      break;
    case "detailed":
      bump(s, "reflectiveDepth", 0.03 * w);
      bump(s, "conversationalEnergy", 0.02 * w);
      break;
    case "short":
      bump(s, "conversationalEnergy", -0.02 * w);
      break;
    case "direct":
      bump(s, "conversationalStability", 0.02 * w);
      break;
    case "balanced":
      // No-op — balanced is the natural midpoint.
      break;
  }
}

function applyShift(
  s: SyntheticSelfState,
  shift: ConversationShift,
  w: number,
): void {
  switch (shift) {
    case "tone_shift":
      bump(s, "emotionalIntensity", 0.04 * w);
      bump(s, "conversationalStability", -0.02 * w);
      break;
    case "topic_change":
      bump(s, "curiosity", 0.03 * w);
      bump(s, "unpredictability", 0.02 * w);
      break;
    case "goal_change":
      bump(s, "conversationalStability", -0.03 * w);
      bump(s, "curiosity", 0.02 * w);
      break;
    case "none":
      // No-op.
      break;
  }
}

// ── Behavioral Bias Derivation ─────────────────────────────

/**
 * A compact set of behavioral hints derived from the state. These are the
 * bridge between numeric internal state and the prompt brief — they keep
 * the brief writer dumb (just a stringifier) and the math testable.
 */
export interface BehavioralBias {
  /** Notes that nudge tone (low energy, high curiosity, etc.). */
  notes: string[];
  /** True when she should lean into a more reflective register. */
  reflective: boolean;
  /** True when she should be slightly more guarded than usual. */
  guarded: boolean;
  /** True when she may take a small spontaneous beat. */
  spontaneous: boolean;
  /** True when she should keep replies tighter than usual. */
  reserved: boolean;
}

/**
 * Translate the numeric state into qualitative hints. Thresholds are
 * deliberately loose — most turns produce 0–2 notes, never a laundry list.
 */
export function deriveBehavioralBias(state: SyntheticSelfState): BehavioralBias {
  const notes: string[] = [];

  // Energy
  if (state.conversationalEnergy < 0.35) notes.push("lower social energy");
  else if (state.conversationalEnergy > 0.75) notes.push("warmer social energy");

  // Openness
  if (state.socialOpenness < 0.35) notes.push("slightly guarded");
  else if (state.socialOpenness > 0.75) notes.push("more open than usual");

  // Curiosity
  if (state.curiosity > 0.7) notes.push("high curiosity");
  else if (state.curiosity < 0.3) notes.push("less curious");

  // Tension / trust
  if (state.tensionTrend > 0.3) notes.push("a touch of latent friction");
  if (state.trustDrift > 0.3) notes.push("trust feels earned right now");
  else if (state.trustDrift < -0.3) notes.push("trust feels uncertain right now");

  // Stability (cadence)
  if (state.conversationalStability < 0.4) notes.push("uneven cadence");

  // Reflective drift
  if (state.reflectiveDepth > 0.65) notes.push("reflective tone drift");

  // Unpredictability — only mention strong cases
  if (state.unpredictability > 0.7) notes.push("room for a spontaneous beat");

  // Attachment — only the strongly negative case is interesting; warm
  // attachment is implied by everything else.
  if (state.attachmentTrend < -0.3) notes.push("a small held-back distance");

  return {
    notes,
    reflective: state.reflectiveDepth > 0.65,
    guarded: state.socialOpenness < 0.35 || state.tensionTrend > 0.3,
    spontaneous: state.unpredictability > 0.7,
    reserved: state.conversationalEnergy < 0.35,
  };
}

// ── Prompt Brief ───────────────────────────────────────────

/**
 * Build the compact behavioral brief that gets injected into the system
 * prompt. Returns null when there's nothing distinctive to say — we never
 * inject filler.
 *
 * Hard constraints baked in:
 *   - No emotion words.
 *   - "Do not mention these states" instruction is always present when
 *     a brief is emitted, so the model treats it as steering, not script.
 *   - Plain text only — no JSON, no key:value dumps.
 */
export function buildSelfStateBrief(state: SyntheticSelfState): string | null {
  const bias = deriveBehavioralBias(state);
  if (bias.notes.length === 0) return null;

  const bullets = bias.notes.map((n) => `- ${n}`).join("\n");
  return [
    "CURRENT CONVERSATIONAL TENDENCIES (internal — never mention these aloud):",
    bullets,
    "Express these only indirectly through how you speak. Do not name them, do not describe yourself in these terms, do not turn them into a status report.",
  ].join("\n");
}

// ── Validation ─────────────────────────────────────────────

/**
 * Coerce an unknown payload (e.g. JSONB from the DB) into a valid state.
 * Missing or non-finite fields fall back to NEUTRAL — we never throw,
 * because a corrupt row should degrade to "neutral self", not break chat.
 */
export function validateSelfState(raw: unknown): SyntheticSelfState {
  if (!raw || typeof raw !== "object") return { ...NEUTRAL_STATE };
  const obj = raw as Record<string, unknown>;
  const out: SyntheticSelfState = { ...NEUTRAL_STATE };
  for (const key of Object.keys(NEUTRAL_STATE) as (keyof SyntheticSelfState)[]) {
    const v = Number(obj[key]);
    if (Number.isFinite(v)) {
      const [min, max] = RANGES[key];
      out[key] = clamp(v, min, max);
    }
  }
  return out;
}
