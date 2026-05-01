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
import type { AutoImageResult } from "@/lib/types";

// ── Per-user cooldown ──────────────────────────────────────

/** Soft per-user throttle to avoid NVIDIA rate-limit stacking */
const USER_LAST_AUTO_IMAGE = new Map<string, number>();
const COOLDOWN_MS = parseInt(process.env.AUTO_IMAGE_COOLDOWN_MS ?? "10000", 10);

function isOnCooldown(userId: string): boolean {
  const last = USER_LAST_AUTO_IMAGE.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function stampCooldown(userId: string): void {
  USER_LAST_AUTO_IMAGE.set(userId, Date.now());
  // Prune map to avoid unbounded growth in long-running instances
  if (USER_LAST_AUTO_IMAGE.size > 10_000) {
    const cutoff = Date.now() - COOLDOWN_MS * 10;
    for (const [k, v] of USER_LAST_AUTO_IMAGE) {
      if (v < cutoff) USER_LAST_AUTO_IMAGE.delete(k);
    }
  }
}

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

    // ── Step 1: Classify intent ──
    const intent = await classifyImageIntent(messages);

    if (!intent.should_generate) {
      return NextResponse.json({ generated: false } satisfies AutoImageResult);
    }

    console.log(
      `[HER Auto] Generating: type=${intent.image_type} ` +
        `confidence=${intent.confidence.toFixed(2)} prompt="${intent.refined_prompt.slice(0, 80)}"`
    );

    // Stamp cooldown now so concurrent requests don't both fire
    stampCooldown(userId);

    // ── Step 2: Route to model ──
    const route = routeImageType(
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
        // Graceful fallback: no reference image → use SD3 create mode
        console.warn("[HER Auto] Reference image missing — falling back to SD3 create mode");
        route.mode = "create";
        route.modelId = "stable-diffusion-3-medium";
        route.useReferenceImage = false;
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

    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;

      const genResult = await generateImageCore({
        prompt: finalPrompt,
        modelId: route.modelId,
        mode: route.mode,
        image: referenceImageDataUrl,
        imageMimeType: referenceImageMimeType,
        ...route.overrides,
        // Vary seed on retry for a different result
        seed: attempt === 2 ? Math.floor(Math.random() * 2_147_483_647) : undefined,
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
        console.log(`[HER Auto] Attempt ${attempt} passed verifier (score=${verification.score})`);
        break;
      }

      console.log(
        `[HER Auto] Attempt ${attempt} failed verifier ` +
          `(score=${verification.score} issues=[${verification.issues.join(", ")}])`
      );

      if (attempt === 2) {
        isSoftCaption = true;
        console.log("[HER Auto] Both attempts failed — sending best-of-two with soft caption");
      }
    }

    if (!bestImage) {
      console.warn("[HER Auto] All generation attempts failed — no image to deliver");
      return NextResponse.json({ generated: false } satisfies AutoImageResult);
    }

    // ── Step 6: Generate contextual delivery caption ──
    const recentContext = messages
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "HER"}: ${m.content.slice(0, 150)}`)
      .join("\n");

    const caption = await generateCaption(recentContext, intent.image_type, isSoftCaption);

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
    console.error(
      "[HER Auto] Unhandled error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ generated: false } satisfies AutoImageResult);
  }
}
