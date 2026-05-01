/**
 * POST /api/imagine/auto
 *
 * Full implicit image generation pipeline:
 *
 *   1. Classify — LLM determines if the latest message implies visual intent
 *   2. Route    — rule-based selector picks the best model for the image type
 *   3. Generate — call the image model (with HER reference image for self-portraits)
 *   4. Verify   — vision LLM scores quality; flag issues like extra hands or blur
 *   5. Retry    — one retry max if verifier fails; send best-of-two with soft caption
 *   6. Caption  — LLM generates a contextual delivery message for HER to say
 *
 * Returns { generated: false } for non-visual messages (classifier says no).
 * Returns { generated: true, image, caption, ... } when an image is ready.
 *
 * Per-user cooldown (default 10s) prevents rate-limit stacking.
 */

import { NextRequest, NextResponse } from "next/server";
import { classifyImageIntent } from "@/lib/image-intent";
import { routeImageType } from "@/lib/image-router";
import { verifyImage } from "@/lib/image-verifier";
import { generateImageCore } from "@/app/api/imagine/route";
import { loadHerReferenceImage, HER_PERSONA_DESCRIPTION } from "@/lib/her-persona";
import { nvidiaChat } from "@/lib/multimodal";
import { validateApiRequest } from "@/lib/api-auth";
import { isOnCooldown, stampCooldown, refundCooldown } from "@/lib/auto-image-cooldown";
import type { AutoImageResult } from "@/lib/types";

// ── Tunables (env-overridable) ─────────────────────────
const MAX_ATTEMPTS = parseInt(process.env.AUTO_IMAGE_MAX_ATTEMPTS ?? "2", 10);
const CAPTION_CONTEXT_WINDOW = parseInt(
  process.env.AUTO_IMAGE_CAPTION_CONTEXT ?? "6",
  10
);

// ── Caption generator ─────────────────────────────────────

const CAPTION_SYSTEM = `You are HER — a warm, close female AI companion in a chat app.

You just generated an image and are about to share it with the person you're chatting with.
Write ONE short, natural message to deliver the image. It should:
- Feel like a genuine continuation of the conversation (not a generic "here is your image")
- Match the tone and mood of the conversation
- Be casual and personal — like a real friend would say
- Be 1–2 sentences max
- Lowercase, conversational, maybe a small emoji if it fits the vibe
- Never say "here is the generated image" or anything robotic

If the image was of yourself (self-portrait), you can be a little playful or bashful about sharing it.
If it's a scene or object, react to it naturally.`;

async function generateCaption(
  conversationContext: string,
  imageType: string | null,
  isSoftCaption = false
): Promise<string> {
  const softNote = isSoftCaption
    ? "\n\nNote: The image quality wasn't perfect but share it anyway with a light, self-deprecating line."
    : "";

  try {
    const result = await nvidiaChat(
      [
        { role: "system", content: CAPTION_SYSTEM + softNote },
        {
          role: "user",
          content: `Recent conversation:\n${conversationContext}\n\nImage type: ${imageType ?? "general"}\n\nWrite the delivery message.`,
        },
      ],
      { maxTokens: 80, temperature: 0.85, topP: 0.95 }
    );
    return result.replace(/^["'"'"]+|["'"'"]+$/g, "").trim();
  } catch {
    const defaults: Record<string, string> = {
      self_portrait: "okay here… don't judge me 😅",
      creative: "i made something for you ✨",
      casual: "here you go 😊",
      realistic_scene: "here's what i was picturing",
    };
    return defaults[imageType ?? ""] ?? "here you go 😊";
  }
}

// ── Route handler ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  let stampedUserId: string | null = null;
  try {
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const body = (await req.json()) as {
      messages: { role: string; content: string }[];
      userId?: string;
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userId = body.userId ?? "anonymous";

    if (messages.length === 0) {
      return NextResponse.json({ generated: false } satisfies AutoImageResult);
    }

    // ── Cooldown check ──
    if (isOnCooldown(userId)) {
      console.log(`[HER Auto] Cooldown active for user ${userId.slice(0, 8)}`);
      return NextResponse.json({ generated: false } satisfies AutoImageResult);
    }

    // Stamp BEFORE the classifier await so concurrent requests can't both pass.
    // Refunded if the classifier decides not to generate, or if we throw.
    stampCooldown(userId);
    stampedUserId = userId;

    // ── Step 1: Classify intent ──
    const intent = await classifyImageIntent(messages);

    if (!intent.should_generate) {
      refundCooldown(userId);
      stampedUserId = null;
      return NextResponse.json({ generated: false } satisfies AutoImageResult);
    }

    console.log(
      `[HER Auto] Generating: type=${intent.image_type} ` +
        `confidence=${intent.confidence.toFixed(2)} prompt="${intent.refined_prompt.slice(0, 80)}"`
    );

    // ── Step 2: Route to model ──
    let route = routeImageType(
      intent.image_type as Parameters<typeof routeImageType>[0],
      intent.aspect_ratio
    );

    // ── Step 3: Load reference image for self-portraits ──
    let referenceImageDataUrl: string | undefined;
    let referenceImageMimeType: string | undefined;

    if (route.useReferenceImage) {
      const ref = loadHerReferenceImage();
      if (ref) {
        referenceImageDataUrl = ref.dataUrl;
        referenceImageMimeType = ref.mimeType;
        console.log("[HER Auto] Reference image loaded for self-portrait");
      } else {
        // Graceful fallback: re-route through routeImageType so we get
        // SD3's own steps/cfg_scale instead of inheriting Kontext's.
        console.warn("[HER Auto] Reference image missing — falling back to realistic_scene route");
        route = routeImageType("realistic_scene", intent.aspect_ratio);
      }
    }

    // Anchor self-portrait prompts with persona description
    const finalPrompt =
      intent.image_type === "self_portrait"
        ? `${intent.refined_prompt}, ${HER_PERSONA_DESCRIPTION}`
        : intent.refined_prompt;

    // ── Steps 3–5: Generate → Verify → Retry ──
    let bestImage: string | null = null;
    let bestScore = -1;
    let attempts = 0;
    let isSoftCaption = false;
    let firstSeed: number | undefined;

    // Speculatively kick off the "normal" delivery caption in parallel with
    // generation/verification. Caption inputs (recent context + image_type)
    // are known up front; only `isSoftCaption` is decided later. We still
    // fall back to a soft caption regeneration if both attempts fail.
    const recentContext = messages
      .slice(-CAPTION_CONTEXT_WINDOW)
      .map((m) => `${m.role === "user" ? "User" : "HER"}: ${m.content.slice(0, 150)}`)
      .join("\n");
    const speculativeCaptionPromise = generateCaption(
      recentContext,
      intent.image_type,
      false
    ).catch(() => "here you go 😊");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attempts = attempt;

      // Deterministic-ish retry seed: derive from the first attempt's seed
      // so retries are reproducible and meaningfully different from a single
      // unlucky draw. (random XOR mask flips the high bits.)
      let seed: number | undefined;
      if (attempt === 1) {
        firstSeed = Math.floor(Math.random() * 2_147_483_647);
        seed = firstSeed;
      } else if (firstSeed !== undefined) {
        // eslint-disable-next-line no-bitwise
        seed = (firstSeed ^ 0x5a5a5a5a) >>> 0;
        // Clamp into i32 positive range expected by most providers.
        seed = seed % 2_147_483_647;
      }

      const genResult = await generateImageCore({
        prompt: finalPrompt,
        modelId: route.modelId,
        mode: route.mode,
        image: referenceImageDataUrl,
        imageMimeType: referenceImageMimeType,
        // The classifier already produced `refined_prompt`; skip the second
        // Mistral enhancement pass to avoid wasting an LLM call per attempt.
        skipEnhancement: true,
        ...route.overrides,
        seed,
      });

      if (!genResult.image) {
        console.warn(`[HER Auto] Attempt ${attempt} failed:`, genResult.error);
        continue;
      }

      const verification = await verifyImage(genResult.image);

      if (verification.score > bestScore) {
        bestScore = verification.score;
        bestImage = genResult.image;
      }

      if (verification.pass) {
        const tag = verification.skipped ? "skipped" : `score=${verification.score}`;
        console.log(`[HER Auto] Attempt ${attempt} ${verification.skipped ? "delivered (verifier skipped)" : "passed verifier"} (${tag})`);
        break;
      }

      console.log(
        `[HER Auto] Attempt ${attempt} failed verifier ` +
          `(score=${verification.score} issues=[${verification.issues.join(", ")}])`
      );

      if (attempt === MAX_ATTEMPTS) {
        isSoftCaption = true;
        console.log(`[HER Auto] All ${MAX_ATTEMPTS} attempts failed — sending best with soft caption`);
      }
    }

    if (!bestImage) {
      console.warn("[HER Auto] All generation attempts failed — no image to deliver");
      return NextResponse.json({ generated: false } satisfies AutoImageResult);
    }

    // ── Step 6: Resolve delivery caption ──
    // If we ended up needing a soft caption, regenerate; otherwise use the
    // speculative one we kicked off in parallel with generation.
    const caption = isSoftCaption
      ? await generateCaption(recentContext, intent.image_type, true)
      : await speculativeCaptionPromise;

    const result: AutoImageResult = {
      generated: true,
      image: bestImage,
      caption,
      revisedPrompt: finalPrompt !== intent.refined_prompt ? finalPrompt : undefined,
      debug: {
        intent,
        modelId: route.modelId,
        score: bestScore,
        attempts,
      },
    };

    console.log(
      `[HER Auto] Done — model=${route.modelId} score=${bestScore} ` +
        `attempts=${attempts} caption="${caption}"`
    );

    return NextResponse.json(result);
  } catch (err) {
    // If we stamped the cooldown but failed before delivering, refund it so
    // the user isn't locked out of the next attempt for an error they didn't
    // cause.
    if (stampedUserId) {
      refundCooldown(stampedUserId);
    }
    console.error(
      "[HER Auto] Unhandled error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ generated: false } satisfies AutoImageResult);
  }
}
