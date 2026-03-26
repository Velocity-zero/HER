import { NextRequest, NextResponse } from "next/server";
import { nvidiaChat, buildImagePromptEnhancerMessages, generateSoftError } from "@/lib/multimodal";

/**
 * POST /api/imagine
 *
 * Two-step image generation pipeline:
 *   1. Mistral Large 3 enriches the user's short prompt into a richer SD3 prompt
 *   2. Stable Diffusion 3 Medium generates the image from the enhanced prompt
 *
 * Returns { image: "data:image/jpeg;base64,..." } on success.
 */

const NVIDIA_SD3_URL =
  "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-medium";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = (await req.json()) as { prompt?: string };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "A prompt is required to imagine something." },
        { status: 400 }
      );
    }

    const imageApiKey = process.env.NVIDIA_IMAGE_API_KEY;
    if (!imageApiKey || imageApiKey === "your_image_key_here") {
      return NextResponse.json(
        { error: "Missing NVIDIA_IMAGE_API_KEY" },
        { status: 500 }
      );
    }

    const originalPrompt = prompt.trim();
    console.log(`[HER Imagine] Original prompt: "${originalPrompt.slice(0, 80)}"`);

    // ── Step 1: Enhance the prompt via Mistral ──
    let finalPrompt = originalPrompt;
    try {
      const enhancerMessages = buildImagePromptEnhancerMessages(originalPrompt);
      const enhanced = await nvidiaChat(enhancerMessages, {
        maxTokens: 300,
        temperature: 0.6,
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

    // ── Step 2: Generate image with SD3 ──
    const apiKey = imageApiKey;
    console.log(`[HER Imagine] Sending to SD3: "${finalPrompt.slice(0, 80)}…"`);

    const res = await fetch(NVIDIA_SD3_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt: finalPrompt,
        cfg_scale: 5,
        aspect_ratio: "1:1",
        seed: 0,
        steps: 40,
        negative_prompt: "",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[HER Imagine] NVIDIA error:", res.status, errBody);

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

    const data = await res.json();

    // NVIDIA SD3 returns { image: "<base64>", ... } or { artifacts: [{ base64 }] }
    let base64Image: string | null = null;

    if (data?.image) {
      base64Image = data.image;
    } else if (data?.artifacts?.[0]?.base64) {
      base64Image = data.artifacts[0].base64;
    }

    if (!base64Image) {
      console.error("[HER Imagine] Unexpected response shape:", JSON.stringify(data).slice(0, 200));
      const emptyMsg = await generateSoftError(
        "image model returned empty result",
        "i imagined it but couldn't capture it… try again?"
      );
      return NextResponse.json({ error: emptyMsg }, { status: 502 });
    }

    // Return as data URL
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    console.log("[HER Imagine] Image generated successfully");

    return NextResponse.json({ image: dataUrl });
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
