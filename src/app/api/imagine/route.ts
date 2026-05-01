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
} from "@/lib/image-models";
import { validateApiRequest, checkBodySize } from "@/lib/api-auth";

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
export function normalizeBase64Image(raw: string | undefined | null): string | null {
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

// ── NVCF Asset Upload Helpers ──────────────────────────────

export const NVCF_ASSETS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/assets";

/**
 * Upload a base64-encoded image to NVCF as a temporary asset.
 * Returns { assetId } on success.
 *
 * Flow:
 *   1. POST to NVCF assets API to create an asset slot → { uploadUrl, assetId }
 *   2. PUT the raw image bytes to the presigned S3 URL
 */
export async function uploadNvcfAsset(
  base64Image: string,
  apiKey: string,
  contentType = "image/jpeg"
): Promise<{ assetId: string }> {
  // Step 1: Create the asset
  const createRes = await fetch(NVCF_ASSETS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      contentType,
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
      "Content-Type": contentType,
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
export async function deleteNvcfAsset(assetId: string, apiKey: string): Promise<void> {
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
export function extractBase64Image(data: Record<string, unknown>): { image: string | null; shape: string } {
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

// ── Core generation function (reusable by POST and auto pipeline) ──────────

export interface GenerateImageOptions {
  prompt: string;
  modelId?: string;
  mode?: "create" | "edit";
  aspect_ratio?: string;
  steps?: number;
  cfg_scale?: number;
  negative_prompt?: string;
  seed?: number;
  /** Base64 data URL for edit mode */
  image?: string;
  /** Override MIME type for NVCF asset upload (e.g. "image/png") */
  imageMimeType?: string;
}

export interface GenerateImageResult {
  image: string | null;
  revisedPrompt?: string;
  error?: string;
  status?: number;
}

/**
 * Core image generation logic — shared by the POST route and the auto pipeline.
 *
 * Does NOT handle HTTP — returns a plain result object.
 * Throws are caught and returned as { error, status }.
 */
export async function generateImageCore(
  opts: GenerateImageOptions
): Promise<GenerateImageResult> {
  const prompt = opts.prompt?.trim();
  if (!prompt) {
    return { image: null, error: "Missing prompt", status: 400 };
  }

  const requestMode = opts.mode || "create";
  let modelId = opts.modelId;
  if (!modelId) {
    modelId = requestMode === "edit" ? DEFAULT_EDIT_MODEL_ID : DEFAULT_CREATE_MODEL_ID;
  }

  if (!isValidModelId(modelId)) {
    return { image: null, error: `Unknown model '${modelId}'`, status: 400 };
  }

  const model = getImageModel(modelId)!;

  if (model.mode !== requestMode) {
    return {
      image: null,
      error: `Model ${model.id} is for ${model.mode} mode, not ${requestMode}.`,
      status: 400,
    };
  }

  const apiKey = resolveApiKey(model);
  if (!apiKey) {
    console.error(
      `[HER Imagine] Missing API key for ${model.label} (${model.envKey}).`
    );
    return {
      image: null,
      error: `API key missing for ${model.label}. Configure ${model.envKey}.`,
      status: 500,
    };
  }

  // ── Validate and prepare source image for edit mode ──
  let normalizedImage: string | undefined;
  let nvcfAssetId: string | undefined;

  if (model.mode === "edit") {
    if (!opts.image) {
      return { image: null, error: "Missing source image for edit mode", status: 400 };
    }
    const safe = normalizeBase64Image(opts.image);
    if (!safe) {
      return { image: null, error: "Invalid image payload", status: 400 };
    }

    if (model.capabilities.image_input) {
      try {
        const mimeType = opts.imageMimeType ?? "image/jpeg";
        const assetResult = await uploadNvcfAsset(safe, apiKey, mimeType);
        nvcfAssetId = assetResult.assetId;
        normalizedImage = `data:image/jpeg;example_id,${assetResult.assetId}`;
        console.log(`[HER Imagine] NVCF asset uploaded: ${assetResult.assetId}`);
      } catch (uploadErr) {
        console.error(
          "[HER Imagine] NVCF asset upload failed:",
          uploadErr instanceof Error ? uploadErr.message : uploadErr
        );
        return {
          image: null,
          error: "Unable to prepare source image for processing.",
          status: 502,
        };
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

  // ── Enhance the prompt via Mistral ──
  const isDetailed =
    originalPrompt.length > 80 && originalPrompt.split(/\s+/).length > 12;
  let finalPrompt = originalPrompt;

  if (isDetailed && model.mode !== "edit") {
    console.log(`[HER Imagine] Prompt already detailed — skipping enhancement`);
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

  // ── Build payload from model registry ──
  const payload = buildImagePayload(model, {
    prompt: finalPrompt,
    aspect_ratio: opts.aspect_ratio,
    steps: opts.steps,
    cfg_scale: opts.cfg_scale,
    negative_prompt: opts.negative_prompt,
    seed: opts.seed,
    image: normalizedImage,
  });

  const cleanPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null && v !== "") {
      cleanPayload[k] = v;
    }
  }

  if (model.capabilities.width_height) {
    const w = cleanPayload.width;
    const h = cleanPayload.height;
    if (typeof w !== "number" || typeof h !== "number" || w < 64 || h < 64) {
      return {
        image: null,
        error: `Invalid image dimensions (${w}×${h})`,
        status: 400,
      };
    }
  }

  // ── Call NVIDIA endpoint ──
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (nvcfAssetId) {
    requestHeaders["NVCF-INPUT-ASSET-REFERENCES"] = nvcfAssetId;
  }

  console.log(
    `[HER Imagine] Sending to ${model.label}: ${JSON.stringify(cleanPayload).slice(0, 300)}`
  );

  const res = await fetch(model.endpoint, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(cleanPayload),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(
      `[HER Imagine] NVIDIA error (${model.label}):\n  Status: ${res.status}\n  Body: ${errBody.slice(0, 500)}`
    );

    let detail = "";
    try {
      const parsed = JSON.parse(errBody);
      detail = parsed?.detail || parsed?.error?.message || parsed?.message || "";
      if (typeof detail === "object") detail = JSON.stringify(detail).slice(0, 200);
    } catch { /* not JSON */ }

    const prefix = model.mode === "edit" ? "Image edit" : "Image generation";

    if (res.status === 429) {
      return { image: null, error: `${prefix} rate limited — try again in about 30 seconds.`, status: 429 };
    }
    if (res.status === 401 || res.status === 403) {
      return { image: null, error: `API key unauthorized for ${model.label}.`, status: res.status };
    }
    if (res.status === 404) {
      return { image: null, error: `Model endpoint unavailable: ${model.id}.`, status: 404 };
    }
    if (res.status === 422) {
      return { image: null, error: `${prefix} failed (422): ${detail || "The provider rejected the request payload."}`, status: 422 };
    }
    if (res.status === 503 || res.status === 502) {
      return { image: null, error: `Image service unavailable (${res.status}). Try again shortly.`, status: res.status };
    }
    return { image: null, error: `${prefix} failed (${res.status}): ${detail || "unknown error"}`, status: 502 };
  }

  // ── Extract image from response ──
  const data = await res.json();
  const { image: base64Image, shape: matchedShape } = extractBase64Image(data);

  if (!base64Image) {
    console.error(
      `[HER Imagine] Unexpected response shape (${model.id}): Keys: ${Object.keys(data).join(", ")}`
    );
    return { image: null, error: "Unexpected response format from image provider", status: 502 };
  }

  console.log(
    `[HER Image] model=${model.id} mode=${model.mode} status=success shape=${matchedShape} b64len=${base64Image.length}`
  );

  const dataUrl = `data:image/jpeg;base64,${base64Image}`;

  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const result: GenerateImageResult = { image: dataUrl };
  if (norm(finalPrompt) !== norm(originalPrompt)) {
    result.revisedPrompt = finalPrompt;
  }

  // Fire-and-forget NVCF asset cleanup
  if (nvcfAssetId) {
    deleteNvcfAsset(nvcfAssetId, apiKey).catch(() => {});
  }

  return result;
}

/**
 * POST /api/imagine
 *
 * Unified image generation pipeline — unchanged public contract.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const sizeError = checkBodySize(req);
    if (sizeError) return sizeError;

    const body = (await req.json()) as ImageGenerationRequest;

    const prompt = body.prompt?.trim();
    if (!prompt || typeof prompt !== "string" || prompt.length === 0) {
      return imageError("Image generation failed (400): Missing prompt", 400);
    }

    const result = await generateImageCore({
      prompt,
      modelId: body.modelId,
      mode: body.mode,
      aspect_ratio: body.aspect_ratio,
      steps: body.steps,
      cfg_scale: body.cfg_scale,
      negative_prompt: body.negative_prompt,
      seed: body.seed,
      image: body.image,
    });

    if (!result.image) {
      return imageError(
        result.error ?? "Image generation failed",
        result.status ?? 502,
        body.modelId
      );
    }

    const response: Record<string, string> = { image: result.image };
    if (result.revisedPrompt) response.revisedPrompt = result.revisedPrompt;

    return NextResponse.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[HER Imagine] Unhandled error:", msg);
    return imageError(`Image generation error: ${msg}`, 502);
  }
}
