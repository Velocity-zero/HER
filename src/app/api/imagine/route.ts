import { NextRequest, NextResponse } from "next/server";
import { nvidiaChat, buildImagePromptEnhancerMessages, buildEditPromptEnhancerMessages, isShortPrompt, generateSoftError } from "@/lib/multimodal";
import { ImageGenerationRequest } from "@/lib/types";
import {
  getImageModel,
  isValidModelId,
  buildImagePayload,
  resolveApiKey,
  DEFAULT_CREATE_MODEL_ID,
  DEFAULT_EDIT_MODEL_ID,
  type ImageModelDef,
} from "@/lib/image-models";

/**
 * POST /api/imagine
 *
 * Unified image generation pipeline supporting:
 *   - Multiple text-to-image models (create mode)
 *   - Image editing model (edit mode)
 *   - Advanced generation controls (capability-aware)
 *
 * Backward compatible: a simple { prompt: "..." } request still works
 * and routes to the default create model (Stable Diffusion 3 Medium).
 *
 * Pipeline:
 *   1. Validate request & resolve model
 *   2. Enhance prompt via Mistral (create=cinematic, edit=precise)
 *   3. Build capability-aware payload from model registry
 *   4. Call the correct NVIDIA endpoint
 *   5. Return { image: "data:image/jpeg;base64,..." }
 */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImageGenerationRequest;

    // ── Validate prompt ──
    const prompt = body.prompt?.trim();
    if (!prompt || typeof prompt !== "string" || prompt.length === 0) {
      return NextResponse.json(
        { error: "A prompt is required to imagine something." },
        { status: 400 }
      );
    }

    // ── Resolve model ──
    const requestMode = body.mode || "create";
    let modelId = body.modelId;

    // Default model selection based on mode
    if (!modelId) {
      modelId = requestMode === "edit" ? DEFAULT_EDIT_MODEL_ID : DEFAULT_CREATE_MODEL_ID;
    }

    // Validate model exists
    if (!isValidModelId(modelId)) {
      return NextResponse.json(
        { error: "That model isn't available right now." },
        { status: 400 }
      );
    }

    const model = getImageModel(modelId)!;

    // Validate mode matches model
    if (model.mode !== requestMode) {
      return NextResponse.json(
        { error: `That model is for ${model.mode} mode, not ${requestMode}.` },
        { status: 400 }
      );
    }

    // ── Resolve API key for this model ──
    // Priority: model-specific env key → shared NVIDIA_IMAGE_API_KEY fallback
    const apiKey = resolveApiKey(model);
    if (!apiKey) {
      console.error(
        `[HER Imagine] Missing API key for ${model.label} (${model.envKey}). ` +
        `Set ${model.envKey} or NVIDIA_IMAGE_API_KEY in .env.local.`
      );
      return NextResponse.json(
        { error: `Missing API key for ${model.label}. Please configure ${model.envKey}.` },
        { status: 500 }
      );
    }

    // Validate edit mode has an image
    if (model.mode === "edit" && !body.image) {
      return NextResponse.json(
        { error: "An image is required for editing." },
        { status: 400 }
      );
    }

    const originalPrompt = prompt;
    const short = isShortPrompt(originalPrompt);
    console.log(
      `[HER Imagine] Model: ${model.label} | Mode: ${model.mode} | Short: ${short} | Prompt: "${originalPrompt.slice(0, 80)}"`
    );

    // ── Step 1: Enhance the prompt via Mistral ──
    let finalPrompt = originalPrompt;
    try {
      const enhancerMessages =
        model.mode === "edit"
          ? buildEditPromptEnhancerMessages(originalPrompt)
          : buildImagePromptEnhancerMessages(originalPrompt);

      // Use slightly higher temperature + more tokens for short prompts to encourage creative expansion
      const enhanced = await nvidiaChat(enhancerMessages, {
        maxTokens: short ? 400 : 300,
        temperature: model.mode === "edit" ? 0.4 : short ? 0.68 : 0.6,
        topP: 0.9,
      });
      // Sanitize: strip any quotes the model might wrap around the output
      finalPrompt = enhanced.replace(/^"|"$/g, "").trim() || originalPrompt;
      console.log(`[HER Imagine] Enhanced prompt: "${finalPrompt.slice(0, 120)}"`);
    } catch (enhanceErr) {
      // If enhancement fails, fall back to original prompt gracefully
      console.warn(
        "[HER Imagine] Prompt enhancement failed, using original:",
        enhanceErr instanceof Error ? enhanceErr.message : enhanceErr
      );
    }

    // ── Step 2: Build payload from model registry ──
    const payload = buildImagePayload(model, {
      prompt: finalPrompt,
      aspect_ratio: body.aspect_ratio,
      steps: body.steps,
      cfg_scale: body.cfg_scale,
      negative_prompt: body.negative_prompt,
      seed: body.seed,
      image: body.image,
    });

    console.log(
      `[HER Imagine] Sending to ${model.label}: ${JSON.stringify(payload).slice(0, 200)}…`
    );

    // ── Step 3: Call NVIDIA endpoint ──
    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[HER Imagine] NVIDIA error (${model.label}):`, res.status, errBody);

      if (res.status === 429) {
        const msg = await generateSoftError(
          "rate limited while generating an image",
          "i need a moment before i can paint again… try in about 30 seconds?"
        );
        return NextResponse.json({ error: msg }, { status: 429 });
      }

      const msg = await generateSoftError(
        "image generation model returned an error",
        "i couldn't paint that just now… try again in a moment."
      );
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // ── Step 4: Extract image from response ──
    const data = await res.json();
    const base64Image = extractBase64Image(data);

    if (!base64Image) {
      console.error(
        `[HER Imagine] Unexpected response shape (${model.label}):`,
        JSON.stringify(data).slice(0, 200)
      );
      const emptyMsg = await generateSoftError(
        "image model returned empty result",
        "i imagined it but couldn't capture it… try again?"
      );
      return NextResponse.json({ error: emptyMsg }, { status: 502 });
    }

    // Return as data URL
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;
    console.log(`[HER Imagine] Image generated successfully via ${model.label}`);

    // Include revisedPrompt metadata when enhancement meaningfully changed the prompt
    // Normalize for comparison: collapse whitespace, trim, case-insensitive
    const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const response: Record<string, string> = { image: dataUrl };
    if (normalize(finalPrompt) !== normalize(originalPrompt)) {
      response.revisedPrompt = finalPrompt;
    }
    return NextResponse.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[HER Imagine] Error:", msg);

    const fallbackMsg = await generateSoftError(
      "unexpected error during image creation",
      "i couldn't paint that just now… try again in a moment."
    );
    return NextResponse.json({ error: fallbackMsg }, { status: 502 });
  }
}

/**
 * Extract base64 image from various NVIDIA response formats.
 * Different models return data in different shapes.
 */
function extractBase64Image(data: Record<string, unknown>): string | null {
  // Format: { image: "<base64>" }
  if (typeof data?.image === "string" && data.image.length > 100) {
    return data.image as string;
  }

  // Format: { artifacts: [{ base64: "..." }] }
  if (Array.isArray(data?.artifacts) && data.artifacts.length > 0) {
    const b64 = (data.artifacts[0] as Record<string, unknown>)?.base64;
    if (typeof b64 === "string" && b64.length > 100) return b64;
  }

  // Format: { output: { image: "..." } }
  if (data?.output && typeof data.output === "object") {
    const output = data.output as Record<string, unknown>;
    if (typeof output.image === "string" && (output.image as string).length > 100) {
      return output.image as string;
    }
  }

  return null;
}
