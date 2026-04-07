import { NextRequest, NextResponse } from "next/server";
import { nvidiaChat, buildImagePromptEnhancerMessages, buildEditPromptEnhancerMessages, isShortPrompt } from "@/lib/multimodal";
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

// ── Helpers ──────────────────────────────────────────────────

/** Build a consistent JSON error response with model metadata. */
function imageError(message: string, status: number, modelId?: string) {
  return NextResponse.json(
    { error: message, status, ...(modelId ? { model: modelId } : {}) },
    { status }
  );
}

/**
 * Normalize an image string into raw base64 (no data-URL prefix).
 * Returns null if the input is clearly invalid.
 */
function normalizeBase64Image(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  // Strip data URL prefix if present
  let b64 = raw;
  const commaIdx = raw.indexOf(",");
  if (raw.startsWith("data:") && commaIdx > 0 && commaIdx < 80) {
    b64 = raw.slice(commaIdx + 1);
  }
  // Basic sanity: must be non-trivial and look like base64
  if (b64.length < 100) return null;
  if (!/^[A-Za-z0-9+/\n\r]+=*$/.test(b64.slice(0, 200))) return null;
  return b64;
}

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
      return imageError("Image generation failed (400): Missing prompt", 400);
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
      return imageError(`Image generation failed (400): Unknown model '${modelId}'`, 400, modelId);
    }

    const model = getImageModel(modelId)!;

    // Validate mode matches model
    if (model.mode !== requestMode) {
      return imageError(
        `Image generation failed (400): Model ${model.id} is for ${model.mode} mode, not ${requestMode}.`,
        400, model.id
      );
    }

    // ── Resolve API key for this model ──
    const apiKey = resolveApiKey(model);
    if (!apiKey) {
      console.error(
        `[HER Imagine] Missing API key for ${model.label} (${model.envKey}). ` +
        `Set ${model.envKey} or NVIDIA_IMAGE_API_KEY in .env.local.`
      );
      return imageError(
        `API key missing for ${model.label}. Configure ${model.envKey}.`,
        500, model.id
      );
    }

    // ── Validate edit mode source image ──
    let normalizedImage: string | undefined;
    /** Populated when the edit model uses the NVCF asset upload flow */
    let nvcfAssetId: string | undefined;
    if (model.mode === "edit") {
      if (!body.image) {
        return imageError("Image edit failed (400): Missing source image", 400, model.id);
      }
      const safe = normalizeBase64Image(body.image);
      if (!safe) {
        return imageError("Image edit failed (400): Invalid image payload", 400, model.id);
      }

      // Kontext requires images via NVCF asset upload (data:image/jpeg;example_id,<uuid> format).
      // Upload the base64 image to S3 via the NVCF asset API, then reference the asset ID.
      if (model.capabilities.image_input) {
        try {
          const assetResult = await uploadNvcfAsset(safe, apiKey);
          nvcfAssetId = assetResult.assetId;
          normalizedImage = `data:image/jpeg;example_id,${assetResult.assetId}`;
          console.log(`[HER Imagine] NVCF asset uploaded: ${assetResult.assetId}`);
        } catch (uploadErr) {
          console.error(
            "[HER Imagine] NVCF asset upload failed:",
            uploadErr instanceof Error ? uploadErr.message : uploadErr
          );
          return imageError("Image edit failed: unable to prepare source image for processing.", 502, model.id);
        }
      } else {
        normalizedImage = safe;
      }
    }

    const originalPrompt = prompt;
    const short = isShortPrompt(originalPrompt);
    console.log(
      `[HER Imagine] Model: ${model.label} | Mode: ${model.mode} | Short: ${short} | Prompt: "${originalPrompt.slice(0, 80)}"`
    );

    // ── Step 1: Enhance the prompt via Mistral ──
    // Skip enhancement for already detailed prompts (saves an API call)
    const isDetailed = originalPrompt.length > 80 && originalPrompt.split(/\s+/).length > 12;
    let finalPrompt = originalPrompt;

    if (isDetailed && model.mode !== "edit") {
      console.log(`[HER Imagine] Prompt already detailed (${originalPrompt.length} chars) — skipping enhancement`);
    } else {
      try {
        const enhancerMessages =
          model.mode === "edit"
            ? buildEditPromptEnhancerMessages(originalPrompt)
            : buildImagePromptEnhancerMessages(originalPrompt);

        const enhanced = await nvidiaChat(enhancerMessages, {
          maxTokens: short ? 400 : 300,
          temperature: model.mode === "edit" ? 0.4 : short ? 0.68 : 0.6,
          topP: 0.9,
        });
        finalPrompt = enhanced.replace(/^"|"$/g, "").trim() || originalPrompt;
        console.log(`[HER Imagine] Enhanced prompt: "${finalPrompt.slice(0, 120)}"`);
      } catch (enhanceErr) {
        console.warn(
          "[HER Imagine] Prompt enhancement failed, using original:",
          enhanceErr instanceof Error ? enhanceErr.message : enhanceErr
        );
      }
    }

    // ── Step 2: Build payload from model registry ──
    const payload = buildImagePayload(model, {
      prompt: finalPrompt,
      aspect_ratio: body.aspect_ratio,
      steps: body.steps,
      cfg_scale: body.cfg_scale,
      negative_prompt: body.negative_prompt,
      seed: body.seed,
      image: normalizedImage,  // already normalized for edit mode
    });

    // Strip any undefined/null/empty-string values to keep the payload clean
    const cleanPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined && v !== null && v !== "") {
        cleanPayload[k] = v;
      }
    }

    // ── Validate resolved dimensions for width_height models ──
    if (model.capabilities.width_height) {
      const w = cleanPayload.width;
      const h = cleanPayload.height;
      if (typeof w !== "number" || typeof h !== "number" || w < 64 || h < 64) {
        return imageError(
          `Image generation failed (400): Invalid image dimensions (${w}×${h})`,
          400, model.id
        );
      }
    }

    console.log(
      `[HER Imagine] Sending to ${model.label} (${model.id}): ${JSON.stringify(cleanPayload).slice(0, 300)}`
    );

    // ── Step 3: Call NVIDIA endpoint ──
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    // Include NVCF asset reference header when using the asset upload flow
    if (nvcfAssetId) {
      requestHeaders["NVCF-INPUT-ASSET-REFERENCES"] = nvcfAssetId;
    }

    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(cleanPayload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(
        `[HER Imagine] NVIDIA error (${model.label} / ${model.id}):\n` +
        `  Status: ${res.status}\n` +
        `  Endpoint: ${model.endpoint}\n` +
        `  Body: ${errBody.slice(0, 500)}`
      );

      // Parse provider error detail if possible
      let detail = "";
      try {
        const parsed = JSON.parse(errBody);
        detail = parsed?.detail || parsed?.error?.message || parsed?.message || "";
        if (typeof detail === "object") detail = JSON.stringify(detail).slice(0, 200);
      } catch { /* not JSON */ }

      const prefix = model.mode === "edit" ? "Image edit" : "Image generation";

      if (res.status === 429) {
        return imageError(`${prefix} rate limited — try again in about 30 seconds.`, 429, model.id);
      }
      if (res.status === 401 || res.status === 403) {
        return imageError(`API key unauthorized for ${model.label}. Check ${model.envKey}.`, res.status, model.id);
      }
      if (res.status === 404) {
        return imageError(`Model endpoint unavailable: ${model.id}. The model may not be supported.`, 404, model.id);
      }
      if (res.status === 422) {
        return imageError(
          `${prefix} failed (422): ${detail || "The provider rejected the request payload."}`,
          422, model.id
        );
      }
      if (res.status === 503 || res.status === 502) {
        return imageError(`Image service unavailable (${res.status}). Try again shortly.`, res.status, model.id);
      }

      return imageError(
        `${prefix} failed (${res.status}): ${detail || errBody.slice(0, 120) || "unknown error"}`,
        502, model.id
      );
    }

    // ── Step 4: Extract image from response ──
    const data = await res.json();
    const { image: base64Image, shape: matchedShape } = extractBase64Image(data);

    if (!base64Image) {
      console.error(
        `[HER Imagine] Unexpected response shape (${model.label} / ${model.id}):\n` +
        `  Keys: ${Object.keys(data).join(", ")}\n` +
        `  Snippet: ${JSON.stringify(data).slice(0, 300)}`
      );
      return imageError(
        `Image generation failed (502): Unexpected response format from image provider`,
        502, model.id
      );
    }

    // Dev-only success breadcrumb
    console.log(
      `[HER Image] model=${model.id} mode=${model.mode} status=success shape=${matchedShape} b64len=${base64Image.length}`
    );

    // Return as data URL
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    // Include revisedPrompt metadata when enhancement meaningfully changed the prompt
    const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const response: Record<string, string> = { image: dataUrl };
    if (norm(finalPrompt) !== norm(originalPrompt)) {
      response.revisedPrompt = finalPrompt;
    }

    // Fire-and-forget NVCF asset cleanup (don't block the response)
    if (nvcfAssetId) {
      deleteNvcfAsset(nvcfAssetId, apiKey).catch(() => {});
    }

    return NextResponse.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[HER Imagine] Unhandled error:", msg);
    return imageError(`Image generation error: ${msg}`, 502);
  }
}

// ── NVCF Asset Upload Helpers ──────────────────────────────

const NVCF_ASSETS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/assets";

/**
 * Upload a base64-encoded image to NVCF as a temporary asset.
 * Returns { assetId } on success.
 *
 * Flow:
 *   1. POST to NVCF assets API to create an asset slot → { uploadUrl, assetId }
 *   2. PUT the raw image bytes to the presigned S3 URL
 */
async function uploadNvcfAsset(
  base64Image: string,
  apiKey: string
): Promise<{ assetId: string }> {
  // Step 1: Create the asset
  const createRes = await fetch(NVCF_ASSETS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      contentType: "image/jpeg",
      description: "her-image-edit-source",
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`NVCF asset create failed (${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const { uploadUrl, assetId } = (await createRes.json()) as {
    uploadUrl: string;
    assetId: string;
  };

  // Step 2: Upload the raw bytes to S3
  const imageBuffer = Buffer.from(base64Image, "base64");
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/jpeg",
      "x-amz-meta-nvcf-asset-description": "her-image-edit-source",
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`NVCF asset upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`);
  }

  return { assetId };
}

/**
 * Delete an NVCF asset after use (fire-and-forget).
 * Failure is non-critical — assets expire automatically.
 */
async function deleteNvcfAsset(assetId: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${NVCF_ASSETS_URL}/${assetId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Non-critical: NVCF assets expire automatically
  }
}

/**
 * Extract base64 image from various NVIDIA response formats.
 * Different models return data in different shapes.
 * Returns { image, shape } so callers can log which format matched.
 */
function extractBase64Image(data: Record<string, unknown>): { image: string | null; shape: string } {
  // Format: { image: "<base64>" }
  if (typeof data?.image === "string" && (data.image as string).length > 100) {
    return { image: data.image as string, shape: "image" };
  }

  // Format: { image_base64: "<base64>" }
  if (typeof data?.image_base64 === "string" && (data.image_base64 as string).length > 100) {
    return { image: data.image_base64 as string, shape: "image_base64" };
  }

  // Format: { artifacts: [{ base64: "..." }] }
  if (Array.isArray(data?.artifacts) && data.artifacts.length > 0) {
    const first = data.artifacts[0] as Record<string, unknown> | undefined;
    if (first) {
      if (typeof first.base64 === "string" && (first.base64 as string).length > 100) {
        return { image: first.base64 as string, shape: "artifacts[0].base64" };
      }
      if (typeof first.b64_json === "string" && (first.b64_json as string).length > 100) {
        return { image: first.b64_json as string, shape: "artifacts[0].b64_json" };
      }
    }
  }

  // Format: { output: { image: "..." } }
  if (data?.output && typeof data.output === "object") {
    const output = data.output as Record<string, unknown>;
    if (typeof output.image === "string" && (output.image as string).length > 100) {
      return { image: output.image as string, shape: "output.image" };
    }
    // Format: { output: { artifacts: [{ base64: "..." }] } }
    if (Array.isArray(output.artifacts) && output.artifacts.length > 0) {
      const nested = (output.artifacts[0] as Record<string, unknown> | undefined);
      if (nested && typeof nested.base64 === "string" && (nested.base64 as string).length > 100) {
        return { image: nested.base64 as string, shape: "output.artifacts[0].base64" };
      }
    }
  }

  return { image: null, shape: "none" };
}
