/**
 * HER — Dynamic Microcopy Generator (Step 21 Part D)
 *
 * Replaces static UI strings with fresh, context-aware text.
 * Uses lightweight LLM generation with a reuse guard.
 *
 * Types: loading_create, loading_edit, greeting, nudge, retry_hint
 *
 * Falls back to curated pools when LLM is unavailable or rate-limited.
 */

import { nvidiaChat } from "./multimodal";

// ── Types ──────────────────────────────────────────────────

export type MicrocopyType =
  | "loading_create"
  | "loading_edit"
  | "greeting"
  | "nudge"
  | "retry_hint"
  | "thinking"
  | "typing";

// ── Reuse Guard ────────────────────────────────────────────

const recentCache = new Map<MicrocopyType, string[]>();
const CACHE_PER_TYPE = 20;

function addToCache(type: MicrocopyType, text: string): void {
  if (!recentCache.has(type)) recentCache.set(type, []);
  const cache = recentCache.get(type)!;
  cache.push(text.toLowerCase());
  if (cache.length > CACHE_PER_TYPE) cache.shift();
}

function isReused(type: MicrocopyType, text: string): boolean {
  const cache = recentCache.get(type);
  if (!cache) return false;
  return cache.includes(text.toLowerCase());
}

// ── Fallback Pools ─────────────────────────────────────────

const POOLS: Record<MicrocopyType, readonly string[]> = {
  loading_create: [
    "pulling something together…", "shaping the scene…", "building it out…",
    "drafting the visuals…", "working on it…", "laying it out…",
    "constructing the frame…", "getting the composition right…",
  ],
  loading_edit: [
    "making adjustments…", "reworking it…", "applying the edit…",
    "tuning the details…", "revising…", "fine-tuning…",
    "working the changes in…", "adjusting things…",
  ],
  greeting: [
    "hey.", "what's up?", "okay — go.", "talk to me.",
    "finally.", "all yours.", "you've got my attention.", "here we go.",
  ],
  nudge: [
    "hey, you still there?", "okay i'm bored. talk to me.",
    "hi. i exist.", "where'd you go lol",
    "it's been a minute.", "you've been quiet.",
  ],
  retry_hint: [
    "that didn't work — try again?", "hmm, something broke. one more time?",
    "okay weird — let's try that again.", "glitch. hit send again?",
    "that went sideways — try once more.", "something hiccuped. go again?",
  ],
  thinking: [
    "thinking…", "one sec…", "hold on…", "hmm…",
    "okay wait…", "gimme a sec…", "working on it…",
  ],
  typing: [
    "typing…", "almost…", "writing…", "one sec…",
    "hang on…", "nearly…", "almost done…",
  ],
};

function pickFresh(type: MicrocopyType): string {
  const pool = POOLS[type] ?? POOLS.thinking;
  // Try to avoid recently used ones
  for (let i = 0; i < 5; i++) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (!isReused(type, candidate)) {
      addToCache(type, candidate);
      return candidate;
    }
  }
  // Fallback: just pick one
  const pick = pool[Math.floor(Math.random() * pool.length)];
  addToCache(type, pick);
  return pick;
}

// ── Rate Limiting ──────────────────────────────────────────

let llmCallCount = 0;
let llmCallResetTime = Date.now();
const MAX_LLM_CALLS_PER_MINUTE = 5;

function canCallLLM(): boolean {
  const now = Date.now();
  if (now - llmCallResetTime > 60_000) {
    llmCallCount = 0;
    llmCallResetTime = now;
  }
  return llmCallCount < MAX_LLM_CALLS_PER_MINUTE;
}

// ── Generator ──────────────────────────────────────────────

const TYPE_DESCRIPTIONS: Record<MicrocopyType, string> = {
  loading_create: "a short label while generating/creating an image. Example: 'building the scene…'",
  loading_edit: "a short label while editing/refining an image. Example: 'tuning the details…'",
  greeting: "a brief casual greeting from HER, 2-5 words. Example: 'hey.'",
  nudge: "a very short re-engagement line when user's been quiet. Example: 'hey, you still there?'",
  retry_hint: "a brief message after an error, encouraging retry. Example: 'something broke — try again?'",
  thinking: "a short thinking/processing label, 1-3 words. Example: 'hmm…'",
  typing: "a short typing indicator label, 1-2 words. Example: 'typing…'",
};

/**
 * Generate fresh microcopy text.
 * Uses LLM when available, falls back to curated pools.
 *
 * @param type - The type of microcopy needed
 * @param context - Optional extra context (e.g. what's being generated)
 */
export async function generateMicrocopy(
  type: MicrocopyType,
  context?: string
): Promise<string> {
  // Rate limit check
  if (!canCallLLM()) {
    return pickFresh(type);
  }

  try {
    llmCallCount++;

    const recentForType = recentCache.get(type) ?? [];
    const avoidNote = recentForType.length > 0
      ? `\nDo NOT use any of these: ${recentForType.slice(-5).join(", ")}`
      : "";

    const response = await nvidiaChat(
      [
        {
          role: "system",
          content: `You are HER — a close female friend. Generate ${TYPE_DESCRIPTIONS[type]}.\n\nRules:\n- 2-8 words max\n- Lowercase, casual\n- End with … if it's a loading/status label\n- Must be unique and fresh\n- Match HER's personality: warm, casual, slightly playful${avoidNote}\n\nReturn ONLY the text. No quotes, no explanation.`,
        },
        {
          role: "user",
          content: context
            ? `Generate for context: ${context}`
            : `Generate a fresh ${type} line.`,
        },
      ],
      { maxTokens: 20, temperature: 0.95 }
    );

    const text = response.trim().replace(/^["']|["']$/g, "").toLowerCase();

    if (text.length >= 2 && text.length <= 60 && !isReused(type, text)) {
      addToCache(type, text);
      return text;
    }

    return pickFresh(type);
  } catch {
    return pickFresh(type);
  }
}

/**
 * Synchronous fallback — picks from pool without LLM.
 * Use this when you can't await (e.g. initial render).
 */
export function getMicrocopySync(type: MicrocopyType): string {
  return pickFresh(type);
}
