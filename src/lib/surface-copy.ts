/**
 * HER — Dynamic Surface Copy System
 *
 * Provides session-stable UI copy that feels fresh across chats.
 * A SurfaceCopyBundle is generated once per chat/session and stays
 * stable for that session's lifetime — no re-render reshuffling.
 *
 * Regenerates on:
 *   - Initial app load
 *   - New Chat creation
 *
 * Does NOT regenerate on:
 *   - Normal React re-renders
 *   - Scroll, typing, streaming, or any mid-chat interaction
 */

// ── Types ──────────────────────────────────────────────────

export type SurfaceCopyBundle = {
  greeting: string;
  starterPrompts: string[];
  thinkingLabel: string;
  replyingLabel: string;
  imageGeneratingLabel: string;
  imageEditingLabel: string;
  studioPlaceholder: string;
  openingLine: string;
  openingSubtext: string;
};

// ── Helpers ─────────────────────────────────────────────────

/** Pick one random item from an array. */
export function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Pick `count` unique random items from an array (no duplicates). */
export function pickUnique<T>(items: readonly T[], count: number): T[] {
  const pool = [...items]; // clone to avoid mutation
  const result: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

// ── Curated Copy Pools ──────────────────────────────────────

export const GREETING_POOL = [
  "hey. what are we getting into today?",
  "hi. so — what's happening?",
  "okay, i'm ready. go.",
  "hey. caught you at a good time?",
  "hi. tell me something — anything.",
  "what's the plan?",
  "hey. you look like you've got something on your mind.",
  "alright. where are we starting?",
  "hi. i was hoping you'd show up.",
  "hey. long day or good day?",
  "hi. what do you need right now?",
] as const;

export const STARTER_PROMPT_POOL = [
  "i need to get something off my chest",
  "make me laugh",
  "i have an idea — help me shape it",
  "help me get through my to-do list",
  "ask me a question i wouldn't expect",
  "surprise me with something i don't know",
  "i'm stuck on a problem",
  "my brain won't turn off",
  "let's make something strange",
  "change my mind about something",
  "recommend something worth my time",
  "i need to think out loud for a minute",
  "roast my terrible idea gently",
  "give me a writing prompt",
  "i have a decision and i keep going in circles",
  "entertain me — i'm bored",
  "what would you do if you were me?",
  "teach me something in under a minute",
  "help me draft a message",
  "i just want to talk",
] as const;

const THINKING_LABEL_POOL = [
  "thinking…",
  "one sec…",
  "hold that thought…",
  "chewing on it…",
  "processing…",
  "let me sit with that…",
  "working on it…",
  "okay hang on…",
] as const;

const REPLYING_LABEL_POOL = [
  "typing…",
  "almost…",
  "writing…",
  "coming together…",
  "bear with me…",
  "right there…",
  "nearly…",
  "got it, one sec…",
] as const;

const IMAGE_GENERATING_LABEL_POOL = [
  "building the scene…",
  "shaping the image…",
  "pulling it together…",
  "drafting something…",
  "working on the visuals…",
  "constructing the frame…",
  "laying it out…",
  "getting the composition right…",
] as const;

const IMAGE_EDITING_LABEL_POOL = [
  "making adjustments…",
  "reworking it…",
  "applying the edit…",
  "tuning the details…",
  "updating the image…",
  "working the changes in…",
  "revising…",
  "fine-tuning…",
] as const;

const STUDIO_PLACEHOLDER_POOL = [
  "what are you picturing?",
  "describe a scene, a mood, or a detail…",
  "what should this look like?",
  "start with the thing you see most clearly…",
  "a vibe, a subject, a setting — anything works…",
  "what's the image in your head?",
  "give me something to work with…",
  "rough idea is fine — go…",
] as const;

const OPENING_LINE_POOL = [
  "it's just us.",
  "okay — go.",
  "right on time.",
  "you've got my attention.",
  "let's do something.",
  "all yours.",
  "ready when you are.",
  "here we go.",
] as const;

const OPENING_SUBTEXT_POOL = [
  "say anything — or nothing at all",
  "start wherever",
  "no wrong way to begin",
  "talk, build, or just think out loud",
  "we'll figure it out from here",
  "whatever comes to mind",
] as const;

// ── Bundle Generator ────────────────────────────────────────

/**
 * Creates a fresh SurfaceCopyBundle with random selections.
 * Call this once on app load and once per New Chat — store the result.
 */
export function createSurfaceCopyBundle(): SurfaceCopyBundle {
  return {
    greeting: pickOne(GREETING_POOL),
    starterPrompts: pickUnique(STARTER_PROMPT_POOL, 4),
    thinkingLabel: pickOne(THINKING_LABEL_POOL),
    replyingLabel: pickOne(REPLYING_LABEL_POOL),
    imageGeneratingLabel: pickOne(IMAGE_GENERATING_LABEL_POOL),
    imageEditingLabel: pickOne(IMAGE_EDITING_LABEL_POOL),
    studioPlaceholder: pickOne(STUDIO_PLACEHOLDER_POOL),
    openingLine: pickOne(OPENING_LINE_POOL),
    openingSubtext: pickOne(OPENING_SUBTEXT_POOL),
  };
}
