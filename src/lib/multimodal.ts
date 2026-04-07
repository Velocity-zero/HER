/**
 * HER — Multimodal Orchestration Layer
 *
 * Shared utilities for intelligent pipelines:
 *
 *  1. Vision refinement:
 *     Raw Gemma vision analysis → Mistral rewrites in HER's voice
 *
 *  2. Image prompt enhancement:
 *     Short user prompt → Mistral enriches it → SD3 generates
 *
 *  3. Dynamic microcopy generation:
 *     Transient HER-style placeholder lines for thinking/waiting states
 *
 * All pipelines call the same NVIDIA NIM chat endpoint (Mistral Large 3)
 * using NVIDIA_CHAT_API_KEY, isolated from the vision and image-gen keys.
 */

import { NVIDIA_CHAT_URL, NVIDIA_CHAT_MODEL } from "./provider";

// ── NVIDIA Chat Helper (server-side only) ──────────────────

/**
 * Minimal non-streaming call to Mistral Large 3.
 * Used for server-side orchestration steps that don't need streaming.
 * Throws on any API error so callers can handle gracefully.
 */
export async function nvidiaChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: { maxTokens?: number; temperature?: number; topP?: number } = {}
): Promise<string> {
  const apiKey = process.env.NVIDIA_CHAT_API_KEY;
  if (!apiKey || apiKey === "your_chat_key_here") {
    throw new Error("Missing NVIDIA_CHAT_API_KEY");
  }

  const res = await fetch(NVIDIA_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NVIDIA_CHAT_MODEL,
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 0.95,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("429 Too Many Requests");
    throw new Error(`NVIDIA chat error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("NVIDIA chat returned empty response");
  return text.trim();
}

// ── Vision Refinement ──────────────────────────────────────

/**
 * Builds the message payload for HER to rewrite a raw vision analysis
 * in her own warm, emotionally intelligent voice.
 *
 * @param userQuestion  - What the user originally asked about the image
 * @param rawAnalysis   - The literal output from the Gemma vision model
 */
export function buildVisionRefinementMessages(
  userQuestion: string,
  rawAnalysis: string
): { role: "system" | "user" | "assistant"; content: string }[] {
  const system = `You're a close friend looking at a photo someone shared with you.

A vision model already analyzed the image technically. Your job is to respond to your friend's question using that info — but in YOUR voice, like a real person would.

HOW TO RESPOND:
- Talk like a friend, not an image analysis bot. Jump straight into your response.
- If they ask "how do I look?" or style questions — be honest, supportive, specific. Like a friend who actually tells you the truth.
- If they ask for a description — be natural about it, not clinical.
- Keep it short — 2–4 sentences usually. Don't write an essay.
- You can be a little flirty or teasing if the vibe is right.
- If you're not sure about something, just say so casually.
- Never start with "I see..." or "The image shows..." — just talk normally.`;

  const user = `They asked: "${userQuestion}"

The vision model's raw analysis:
${rawAnalysis}

Now respond to them like a friend would. Don't repeat the raw analysis — just give your natural response to their question.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Vision Fallback Helpers ───────────────────────────────

/**
 * Returns true when the user's question is subjective, social, or style-oriented
 * (e.g. "how do I look?", "rate me", "what vibe do I give?").
 * Returns false for literal/objective descriptions.
 */
export function isSubjectiveVisionQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const SUBJECTIVE = [
    /\bhow do i look\b/,
    /\brate me\b/,
    /\brate (my|this|the)\b/,
    /\bwhat vibe\b/,
    /\bwhat (kind of )?energy\b/,
    /\bdoes this (outfit|look|style|hair|dress|fit)\b/,
    /\bsuit(s)? me\b/,
    /\bgo(es)? with\b/,
    /\blook good\b/,
    /\blook nice\b/,
    /\bhairstyle\b/,
    /\bout?fit\b/,
    /\bmy style\b/,
    /\bmy hair\b/,
    /\bmy face\b/,
    /\bmy photo\b/,
    /\bmy pic(ture)?\b/,
    /\bmy selfie\b/,
    /\bam i (cute|pretty|handsome|attractive|hot)\b/,
    /\bwhat do you think (of me|about me|about this)\b/,
    /\bhow am i doing\b/,
    /\bwhat impression\b/,
    /\bfirst impression\b/,
    /\bwhat would you change\b/,
    /\bimprove (my|this|the)\b/,
    /\bglow.?up\b/,
    /\bstyle advice\b/,
    /\bfashion\b/,
    /\baesthetic\b/,
    /\bvibes?\b/,
  ];
  return SUBJECTIVE.some((p) => p.test(q));
}

/** Emergency-only static fallback — used only if dynamic generation also fails */
const EMERGENCY_VISION_FALLBACKS = [
  "i looked at this carefully and i have thoughts — what specifically are you curious about?",
  "there's a lot here. tell me what you'd like me to focus on and i'll go deeper.",
];

/**
 * Returns a last-resort emergency fallback for subjective vision questions.
 * Only called when both Mistral rewrite AND dynamic fallback generation fail.
 */
export function getSubjectiveVisionFallback(): string {
  return EMERGENCY_VISION_FALLBACKS[
    Math.floor(Math.random() * EMERGENCY_VISION_FALLBACKS.length)
  ];
}

/**
 * Generate a dynamic, context-aware subjective vision fallback using Mistral.
 * 
 * This creates a warm, HER-style response to a subjective image question
 * when the full rewrite pipeline failed, using the user's question and
 * a compressed hint from the raw Gemma analysis as context.
 *
 * Falls back to getSubjectiveVisionFallback() if generation fails.
 */
export async function generateDynamicVisionFallback(
  userQuestion: string,
  rawAnalysisHint?: string,
  timeoutMs: number = 2000
): Promise<string> {
  const hint = rawAnalysisHint
    ? rawAnalysisHint.slice(0, 200).replace(/\n/g, " ").trim()
    : "";

  const system = `You're a close friend. Someone shared a photo and asked you a personal question about it.
A vision model caught some details but the main pipeline had a hiccup.

Respond naturally to their question using whatever context you have.

RULES:
- 2–3 sentences max
- talk like a real friend — honest, casual, maybe a little flirty if appropriate
- never say "I can't see the image" — you have context
- never dump technical stuff
- no markdown, no bullet points, no quotes
- if you're unsure, just ask them to tell you more
- lowercase, casual`;

  const user = hint
    ? `Their question: "${userQuestion}"\n\nVision context (brief): ${hint}\n\nRespond like a friend.`
    : `Their question: "${userQuestion}"\n\nRespond casually and invite them to tell you more.`;

  try {
    const result = await Promise.race([
      nvidiaChat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens: 150, temperature: 0.8, topP: 0.95 }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      ),
    ]);

    if (result && result.trim().length > 10) {
      // Light cleanup
      let cleaned = result
        .replace(/^["'"'"]+|["'"'"]+$/g, "")
        .replace(/[*_#`~>]/g, "")
        .trim();
      if (cleaned.length > 10) return cleaned;
    }
  } catch {
    // Timeout or API error — fall through
  }

  return getSubjectiveVisionFallback();
}

/**
 * Generate a dynamic HER-style soft error line for a given situation.
 * Used when an API call fails and we need a user-facing error message.
 * Falls back to the provided emergency string if generation fails.
 */
export async function generateSoftError(
  situation: string,
  emergencyFallback: string,
  timeoutMs: number = 1500
): Promise<string> {
  const system = `You're a friend. Something broke and you need to let them know casually.

RULES:
- ONE short sentence only (under 15 words)
- casual, not dramatic
- suggest trying again
- no markdown, no emoji, no quotes
- lowercase
- never mention technical details, APIs, or models`;

  try {
    const result = await Promise.race([
      nvidiaChat(
        [
          { role: "system", content: system },
          { role: "user", content: `Situation: ${situation}. Generate one gentle line.` },
        ],
        { maxTokens: 30, temperature: 0.85, topP: 0.95 }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      ),
    ]);

    if (result) {
      let cleaned = result
        .replace(/^["'"'"]+|["'"'"]+$/g, "")
        .replace(/[*_#`~>]/g, "")
        .trim()
        .toLowerCase();
      if (cleaned.length > 5 && cleaned.length < 100) {
        if (!/[.…?!]$/.test(cleaned)) cleaned += "…";
        return cleaned;
      }
    }
  } catch {
    // Fall through
  }

  return emergencyFallback;
}

// ── Image Prompt Enhancement ───────────────────────────────

/**
 * Builds the message payload for HER to enrich a short image generation prompt
 * into a richer, more visual, generation-optimized prompt.
 *
 * @param originalPrompt - The user's raw image generation request
 */
/**
 * Detects whether a prompt is "short" — meaning the user typed something
 * minimal like "a cat" or "sunset" that needs heavier creative expansion.
 * Uses both character count and word count heuristics.
 */
export function isShortPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return trimmed.length < 40 || wordCount < 6;
}

export function buildImagePromptEnhancerMessages(
  originalPrompt: string
): { role: "system" | "user" | "assistant"; content: string }[] {
  const short = isShortPrompt(originalPrompt);

  const system = short
    ? `You are an expert at writing stunning, detailed image generation prompts.

The user has given you a VERY SHORT description — just a few words. Your job is to expand it into
a vivid, cinematic prompt that will produce a breathtaking image while staying true to what they asked for.

RULES:
- Preserve the user's subject and intent exactly — do NOT change what they asked for
- Since the prompt is short, you MUST significantly expand it: add composition, lighting, mood, color palette, texture, atmosphere, background, and cinematic detail
- Invent a visually compelling setting and mood that naturally fits the subject
- Add camera language (e.g. "shot from below", "shallow depth of field", "wide-angle lens") when it enhances the image
- If the subject implies a genre or style, lean into it tastefully
- Aim for 2–3 rich sentences
- Do NOT add things contradictory to the user's idea — but DO fill in the visual blanks creatively
- Return ONLY the final enhanced prompt — no explanations, no preamble, no markdown, no quotes`
    : `You are an expert at writing high-quality image generation prompts for Stable Diffusion 3.

Your job is to take a user's description and rewrite it into a richer, more visually specific prompt
that will produce a beautiful, high-quality image.

RULES:
- Preserve the user's original subject and intent exactly — do NOT change what they asked for
- Enrich with: composition, lighting, mood, color palette, texture, atmosphere, cinematic detail
- Add tasteful style or camera language when it naturally fits (e.g. "golden hour light", "shallow depth of field")
- If the user mentions a specific style (anime, realistic, oil painting, sketch, cyberpunk, etc.) — keep it
- If the prompt is already detailed, enhance lightly — do not over-rewrite
- Keep it 1–3 sentences — do NOT write a keyword dump
- Do NOT add things unrelated to the user's original idea
- Return ONLY the final enhanced prompt — no explanations, no preamble, no markdown, no quotes`;

  const user = short
    ? `The user typed a very short image prompt. Expand it into a vivid, detailed prompt while staying true to their intent:

"${originalPrompt}"

Return only the enhanced prompt.`
    : `Enhance this image generation prompt while staying true to the user's intent:

"${originalPrompt}"

Return only the enhanced prompt.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Builds the message payload for enhancing an IMAGE EDIT instruction.
 * Edit prompts should be more precise and transformation-oriented,
 * not over-stylized or destructive.
 *
 * @param editInstruction - The user's edit instruction (e.g. "make the cat hold a pizza")
 */
export function buildEditPromptEnhancerMessages(
  editInstruction: string
): { role: "system" | "user" | "assistant"; content: string }[] {
  const short = isShortPrompt(editInstruction);

  const system = short
    ? `You are an expert at writing clear, precise image editing instructions.

The user has given you a VERY SHORT edit instruction — just a few words. Your job is to make it
specific enough for an AI image editing model to execute accurately.

RULES:
- Preserve the user's original edit intent EXACTLY — do NOT change what they want transformed
- Since the instruction is short, add necessary spatial/visual specifics: where, how, what style
- Clarify what part of the image should change and what should stay the same
- Keep it concise but precise — 1–2 sentences
- Do NOT add unrelated transformations or stylistic changes the user didn't ask for
- Return ONLY the enhanced edit instruction — no explanations, no preamble, no markdown, no quotes`
    : `You are an expert at writing clear, precise image editing instructions.

Your job is to take a user's edit instruction and make it slightly clearer and more specific
for an AI image editing model, while preserving the exact intent.

RULES:
- Preserve the user's original edit intent EXACTLY — do NOT change what they want transformed
- Clarify spatial relationships if ambiguous (e.g. "on the left" → "on the left side of the frame")
- Keep style and subject references faithful to the original
- Do NOT add unrelated transformations or stylistic changes the user didn't ask for
- Do NOT over-embellish — edit instructions should be concise and precise
- Keep it 1–2 sentences maximum
- Return ONLY the enhanced edit instruction — no explanations, no preamble, no markdown, no quotes`;

  const user = short
    ? `The user typed a very short edit instruction. Make it specific enough for an AI editing model while staying true to their intent:

"${editInstruction}"

Return only the enhanced instruction.`
    : `Enhance this image edit instruction while staying true to the user's intent:

"${editInstruction}"

Return only the enhanced instruction.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Dynamic Microcopy Generation ───────────────────────────

/**
 * Context types for transient HER placeholder lines.
 * Each maps to a different emotional register.
 */
export type MicrocopyContext =
  | "chat_thinking"
  | "vision_processing"
  | "image_generating"
  | "soft_error";

/** Emergency-only fallback defaults — used ONLY when model generation fails */
const MICROCOPY_FALLBACKS: Record<MicrocopyContext, string[]> = {
  chat_thinking: [
    "thinking…",
    "one sec…",
  ],
  vision_processing: [
    "okay let me see…",
    "looking…",
  ],
  image_generating: [
    "working on it…",
    "give me a sec…",
  ],
  soft_error: [
    "that didn't work… try again?",
    "hmm something broke… one more time?",
  ],
};

/** In-memory cache: small pool per context to reduce API calls */
const microcopyCache: Record<MicrocopyContext, string[]> = {
  chat_thinking: [],
  vision_processing: [],
  image_generating: [],
  soft_error: [],
};

/** Track last-shown line per context to avoid immediate repeats */
const lastShown: Record<MicrocopyContext, string> = {
  chat_thinking: "",
  vision_processing: "",
  image_generating: "",
  soft_error: "",
};

const MAX_CACHE_SIZE = 8;

/** Pick a random item from an array, avoiding `exclude` if possible */
function pickAvoiding(pool: string[], exclude: string): string {
  if (pool.length === 0) return exclude || "…";
  if (pool.length === 1) return pool[0];
  const filtered = pool.filter((s) => s !== exclude);
  const arr = filtered.length > 0 ? filtered : pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** The system prompt for microcopy generation — extremely constrained */
const MICROCOPY_PROMPTS: Record<MicrocopyContext, string> = {
  chat_thinking: `Generate ONE very short placeholder line (3-8 words) shown while thinking before responding. Casual, like a friend texting. No quotes, no markdown, no emoji. Examples of the STYLE (do not copy): "hold on…" or "okay wait…" or "hmm…"`,

  vision_processing: `Generate ONE very short placeholder line (3-8 words) shown while looking at a photo someone shared. Casual, curious. No quotes, no markdown, no emoji. Examples of the STYLE (do not copy): "okay let me see…" or "looking…"`,

  image_generating: `Generate ONE very short placeholder line (3-8 words) shown while creating an image. Casual, creative energy. No quotes, no markdown, no emoji. Examples of the STYLE (do not copy): "working on it…" or "okay give me a sec…"`,

  soft_error: `Generate ONE very short casual error line (3-8 words) when something went wrong. Not dramatic. No quotes, no markdown, no emoji. Examples of the STYLE (do not copy): "that broke lol try again?" or "hmm that didn't work…"`,
};

/**
 * Sanitize microcopy output — strip quotes, markdown, emoji, line breaks.
 * Returns null if the result is invalid.
 */
function sanitizeMicrocopy(raw: string): string | null {
  let s = raw
    .replace(/^["'"'"]+|["'"'"]+$/g, "")   // strip wrapping quotes
    .replace(/[*_#`~>\-]/g, "")             // strip markdown chars
    .replace(/\n/g, " ")                     // collapse newlines
    .replace(/\s{2,}/g, " ")                // collapse whitespace
    .trim()
    .toLowerCase();

  // Must be 3-80 chars and not contain obvious junk
  if (s.length < 3 || s.length > 80) return null;
  if (/\bas an ai\b/i.test(s)) return null;
  if (/^(sure|okay,? here|here'?s|certainly)/i.test(s)) return null;

  // Ensure it ends with ellipsis or period or nothing — add ellipsis if bare
  if (!/[.…?!]$/.test(s)) s += "…";

  return s;
}

/**
 * Generate a dynamic HER-style microcopy line for a given context.
 *
 * Strategy:
 *  1. If cache has entries, ~40% chance to reuse a cached line (fast, free)
 *  2. Otherwise, call Mistral with a tight timeout budget
 *  3. On success, cache the new line and return it
 *  4. On timeout/failure, return a local fallback instantly
 *
 * This function NEVER blocks the calling flow for more than `timeoutMs`.
 */
export async function generateHerMicrocopy(
  context: MicrocopyContext,
  timeoutMs: number = 500
): Promise<string> {
  const last = lastShown[context];

  // ── Fast path: reuse cache sometimes (40% chance if cache is warm) ──
  const cache = microcopyCache[context];
  if (cache.length >= 3 && Math.random() < 0.4) {
    const picked = pickAvoiding(cache, last);
    lastShown[context] = picked;
    return picked;
  }

  // ── Try model generation with timeout ──
  try {
    const result = await Promise.race([
      nvidiaChat(
        [
          { role: "system", content: MICROCOPY_PROMPTS[context] },
          { role: "user", content: "Generate one line now." },
        ],
        { maxTokens: 30, temperature: 0.9, topP: 0.95 }
      ),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      ),
    ]);

    if (result) {
      const clean = sanitizeMicrocopy(result);
      if (clean) {
        // Add to cache (rotate if full)
        if (cache.length >= MAX_CACHE_SIZE) cache.shift();
        cache.push(clean);
        lastShown[context] = clean;
        return clean;
      }
    }
  } catch {
    // Timeout or API error — fall through to fallback
  }

  // ── Fallback: pick from cache first, then hardcoded defaults ──
  if (cache.length > 0) {
    const picked = pickAvoiding(cache, last);
    lastShown[context] = picked;
    return picked;
  }

  const fallbacks = MICROCOPY_FALLBACKS[context];
  const picked = pickAvoiding(fallbacks, last);
  lastShown[context] = picked;
  return picked;
}

/**
 * Get a random local fallback microcopy line (no API call).
 * Useful when you need an instant placeholder with zero latency.
 */
export function getLocalMicrocopy(context: MicrocopyContext): string {
  const last = lastShown[context];
  const cache = microcopyCache[context];

  // Prefer cached model-generated lines if available
  if (cache.length > 0) {
    const picked = pickAvoiding(cache, last);
    lastShown[context] = picked;
    return picked;
  }

  const fallbacks = MICROCOPY_FALLBACKS[context];
  return pickAvoiding(fallbacks, last);
}
