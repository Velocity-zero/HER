/**
 * HER — Anti-Repetition Runtime Engine (Step 21 Part C)
 *
 * Runtime layer that tracks recent assistant messages and detects
 * structural/tonal repetition patterns. When detected, it injects
 * a variation instruction before the next response is generated.
 *
 * Complements the static continuity system (continuity.ts) with
 * runtime detection of harder-to-catch patterns.
 */

// ── Types ──────────────────────────────────────────────────

interface RepetitionCheck {
  hasRepeatedOpening: boolean;
  hasRepeatedStructure: boolean;
  hasRepeatedTone: boolean;
  variationInstruction: string | null;
}

// ── Detection ──────────────────────────────────────────────

const COMMON_OPENINGS = [
  "oh", "hey", "haha", "hmm", "okay", "honestly",
  "i", "that", "so", "well", "aww", "wait",
];

/** Extract first 2 words, lowercased, as opening fingerprint */
function getOpening(text: string): string {
  return text.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase().replace(/[.,!?]+$/, "");
}

/** Rough structure fingerprint: sentence count + question presence + length bucket */
function getStructure(text: string): string {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const hasQuestion = text.includes("?");
  const lenBucket = text.length < 80 ? "S" : text.length < 200 ? "M" : "L";
  return `${sentences}s-${hasQuestion ? "Q" : "N"}-${lenBucket}`;
}

/** Simple tone classification from text */
function getTone(text: string): string {
  const t = text.toLowerCase();
  if (/\b(haha|lol|lmao|😂|funny)\b/.test(t)) return "playful";
  if (/\b(i'm here|that sounds|i hear you|must be)\b/.test(t)) return "supportive";
  if (/\b(try|consider|you could|here's|step)\b/.test(t)) return "advisory";
  if (/\?/.test(t) && t.length < 100) return "questioning";
  return "neutral";
}

/**
 * Check if the current draft would be repetitive given recent history.
 * Returns a variation instruction if repetition is detected.
 *
 * @param recentAssistant - Last 5-8 assistant messages (newest last)
 */
export function checkRepetition(recentAssistant: string[]): RepetitionCheck {
  if (recentAssistant.length < 3) {
    return { hasRepeatedOpening: false, hasRepeatedStructure: false, hasRepeatedTone: false, variationInstruction: null };
  }

  const recent = recentAssistant.slice(-6);
  const openings = recent.map(getOpening);
  const structures = recent.map(getStructure);
  const tones = recent.map(getTone);

  // ── Opening repetition: same first 2 words 3+ times ──
  const openingCounts = new Map<string, number>();
  for (const o of openings) openingCounts.set(o, (openingCounts.get(o) || 0) + 1);
  const hasRepeatedOpening = [...openingCounts.values()].some((c) => c >= 3);

  // ── Structure repetition: same structure 3+ times in a row ──
  let structureStreak = 1;
  for (let i = structures.length - 2; i >= 0; i--) {
    if (structures[i] === structures[structures.length - 1]) structureStreak++;
    else break;
  }
  const hasRepeatedStructure = structureStreak >= 3;

  // ── Tone repetition: same tone 4+ times ──
  const toneCounts = new Map<string, number>();
  for (const t of tones) toneCounts.set(t, (toneCounts.get(t) || 0) + 1);
  const hasRepeatedTone = [...toneCounts.values()].some((c) => c >= 4);

  // ── Build instruction ──
  const issues: string[] = [];
  if (hasRepeatedOpening) {
    const repeatedWord = [...openingCounts.entries()].find(([, c]) => c >= 3)?.[0];
    issues.push(`You've started ${openingCounts.get(repeatedWord!) || 3}+ recent responses with "${repeatedWord}". Start completely differently this time.`);
  }
  if (hasRepeatedStructure) {
    issues.push("Your last few responses all had the same shape/length. Vary the structure — try a different sentence count or style.");
  }
  if (hasRepeatedTone) {
    const dominantTone = [...toneCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    issues.push(`Your tone has been consistently "${dominantTone}". Shift it up — be surprising, vary your energy.`);
  }

  return {
    hasRepeatedOpening,
    hasRepeatedStructure,
    hasRepeatedTone,
    variationInstruction: issues.length > 0
      ? `ANTI-REPETITION ALERT:\n${issues.map((i) => `- ${i}`).join("\n")}`
      : null,
  };
}

/**
 * Quick boolean check: should the response be varied?
 */
export function shouldVaryResponse(recentAssistant: string[]): boolean {
  const check = checkRepetition(recentAssistant);
  return check.variationInstruction !== null;
}
