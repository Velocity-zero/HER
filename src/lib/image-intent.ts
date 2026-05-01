/**
 * HER — Image Intent Classifier
 *
 * Determines whether a user message (in context) implies they want an image
 * generated — including implicit visual intent like "I wanna see you".
 *
 * Pipeline:
 *   1. Cheap regex pre-filter (client/server) — skips ~70% of messages instantly
 *   2. LLM classifier (Mistral, ~500ms) — accurate JSON intent result
 */

import { nvidiaChat } from "./multimodal";
import type { ImageIntent } from "./types";

// ── Regex pre-filter ───────────────────────────────────────

/**
 * Broad visual-keyword patterns.
 * Intentionally permissive — false positives are filtered by the LLM.
 * False negatives here mean we skip the LLM entirely (wasted cost avoided).
 */
const VISUAL_KEYWORD_PATTERNS = [
  /\b(see|show|look|appear|face|photo|pic|image|picture|draw|paint|sketch|generate|create|selfie)\b/i,
  /\bi (wanna|want to|would like to|gotta|need to) see\b/i,
  /\bshow me\b/i,
  /\bsend me\b/i,
  /\bcan i see\b/i,
  /\bwhat.*look like\b/i,
  /\byour (face|appearance|outfit|room|place|background|surroundings)\b/i,
  /\bhow (do|would) you look\b/i,
  /\blet me see\b/i,
  /\bpicture of\b/i,
];

/**
 * Returns true when the text contains at least one visual keyword
 * that could indicate image-generation intent.
 * Does NOT make a final decision — only used as a cheap pre-filter.
 */
export function mightWantImage(text: string): boolean {
  return VISUAL_KEYWORD_PATTERNS.some((p) => p.test(text));
}

// ── LLM Classifier ────────────────────────────────────────

const CLASSIFIER_SYSTEM_PROMPT = `You are an image-intent classifier for an AI companion app called HER.

HER is a warm, close female AI companion. She can generate:
- Images of herself (self-portraits)
- Creative/artistic scenes
- Casual everyday images
- Realistic scenes or environments

TASK: Analyze the conversation and classify whether the latest user message implies they want an image generated. Consider both explicit requests and implicit visual desires.

IMPLICIT triggers (user didn't say "generate" but clearly wants to see something):
- "I wanna see how you look" → self_portrait
- "what do you look like in person?" → self_portrait
- "send me a pic of yourself" → self_portrait
- "can I see you?" → self_portrait
- "I bet you're beautiful" (curiosity about appearance) → self_portrait
- "show me your room / place / surroundings" → realistic_scene
- "what are you wearing right now?" → self_portrait
- "I'd love to see a sunset right now" → realistic_scene

EXPLICIT triggers (obvious image request):
- "draw me a sunset" → realistic_scene
- "generate an image of a forest" → realistic_scene
- "paint me something beautiful" → creative
- "create a picture of a cat" → casual

FALSE POSITIVES (do NOT generate):
- "I see your point"
- "I can picture that"
- "show me how to do this" (instructional)
- "what do you think about X?" (opinion)
- "show me some love" (figurative)
- "make me a playlist / plan / list"
- "I'd like to see you succeed" (figurative)
- "picture this scenario" (hypothetical)
- "I see what you mean"
- General conversation with no visual intent
- "I want to see change" (abstract)

image_type values:
- "self_portrait": user wants to see HER herself
- "creative": artistic, fantastical, or stylized scene
- "casual": quick everyday scene or object
- "realistic_scene": realistic environment, person, or scenario

aspect_ratio guidance:
- "1:1" for portraits and selfies (default for self_portrait)
- "9:16" for full-body shots
- "16:9" for landscapes and wide scenes
- "3:4" for most other images

refined_prompt: Create a detailed image generation prompt using conversation context.
- For self_portrait: describe HER in the scene/context (e.g., "candid portrait of a young woman...")
- For other types: describe the scene clearly with style and mood

Confidence: 0.0–1.0. Use ≥0.7 for clear cases, 0.5–0.69 for ambiguous.

Respond ONLY with valid JSON matching this exact schema:
{
  "should_generate": boolean,
  "confidence": number,
  "image_type": "self_portrait" | "creative" | "casual" | "realistic_scene" | null,
  "refined_prompt": string,
  "aspect_ratio": "1:1" | "4:5" | "3:4" | "16:9" | "9:16",
  "reason": string
}`;

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Classify whether the latest message in a conversation implies image intent.
 *
 * @param messages - Recent conversation messages (last ~8 is enough)
 * @returns ImageIntent with should_generate and full context for routing
 */
export async function classifyImageIntent(
  messages: { role: string; content: string }[]
): Promise<ImageIntent> {
  const fallback: ImageIntent = {
    should_generate: false,
    confidence: 0,
    image_type: null,
    refined_prompt: "",
    aspect_ratio: "1:1",
    reason: "pre-filter: no visual keywords",
  };

  // Pre-filter: only run LLM if the last user message has any visual keyword
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg || !mightWantImage(lastUserMsg.content)) {
    return fallback;
  }

  // Build a compact conversation context for the classifier
  const recentContext = messages
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "HER"}: ${m.content.slice(0, 200)}`)
    .join("\n");

  try {
    const raw = await nvidiaChat(
      [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Conversation:\n${recentContext}\n\nClassify the latest user message. Respond with JSON only.`,
        },
      ],
      { maxTokens: 300, temperature: 0.2, topP: 0.9 }
    );

    // Strip markdown code fences the LLM sometimes wraps around JSON
    const cleaned = raw.replace(/^```json\n?|^```\n?|\n?```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as ImageIntent;

    // Validate shape
    if (
      typeof parsed.should_generate !== "boolean" ||
      typeof parsed.confidence !== "number"
    ) {
      console.warn("[HER Intent] Unexpected classifier shape:", cleaned.slice(0, 200));
      return { ...fallback, reason: "malformed classifier response" };
    }

    // Apply confidence gate
    if (parsed.should_generate && parsed.confidence < CONFIDENCE_THRESHOLD) {
      return {
        ...parsed,
        should_generate: false,
        reason: `below confidence threshold (${parsed.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD})`,
      };
    }

    console.log(
      `[HER Intent] should_generate=${parsed.should_generate} ` +
      `type=${parsed.image_type} confidence=${parsed.confidence.toFixed(2)} ` +
      `reason="${parsed.reason}"`
    );

    return parsed;
  } catch (err) {
    console.warn(
      "[HER Intent] Classifier error:",
      err instanceof Error ? err.message : err
    );
    return { ...fallback, reason: "classifier exception" };
  }
}
