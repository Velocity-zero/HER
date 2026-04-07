import { NextRequest, NextResponse } from "next/server";
import {
  nvidiaChat,
  buildVisionRefinementMessages,
  isSubjectiveVisionQuestion,
  generateDynamicVisionFallback,
  generateSoftError,
} from "@/lib/multimodal";

/**
 * POST /api/vision
 *
 * Two-step multimodal pipeline:
 *   1. Gemma 3 27B analyzes the image → raw technical description
 *   2. Mistral Large 3 rewrites the analysis in HER's warm voice
 *
 * Accepts { image: "data:image/...;base64,...", prompt?: string }
 * Returns  { message: string }  ← always HER-toned, never raw CV output
 */

const NVIDIA_VISION_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_VISION_MODEL = "google/gemma-3-27b-it";

const DEFAULT_PROMPT = "Describe this image.";

/** Max base64 payload size we'll accept (~6 MB raw → ~8 MB base64) */
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, prompt } = body as { image?: string; prompt?: string };

    // ── Validate image ──
    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "An image is required for vision analysis." },
        { status: 400 }
      );
    }

    if (!image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Image must be a base64 data URL (data:image/...)." },
        { status: 400 }
      );
    }

    if (image.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { error: "that image is way too big — try a smaller one?" },
        { status: 413 }
      );
    }

    // ── Validate API key ──
    const apiKey = process.env.NVIDIA_VISION_API_KEY;
    if (!apiKey || apiKey === "your_vision_key_here") {
      return NextResponse.json(
        { error: "Missing NVIDIA_VISION_API_KEY" },
        { status: 500 }
      );
    }

    const userPrompt = (prompt && prompt.trim()) || DEFAULT_PROMPT;

    console.log(
      `[HER Vision] Analyzing image (${Math.round(image.length / 1024)}KB) — prompt: "${userPrompt.slice(0, 60)}…"`
    );

    // ── Build multimodal payload (OpenAI-compatible format) ──
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image_url",
            image_url: {
              url: image,
            },
          },
        ],
      },
    ];

    const res = await fetch(NVIDIA_VISION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_VISION_MODEL,
        messages,
        max_tokens: 512,
        temperature: 0.2,
        top_p: 0.7,
        stream: false,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[HER Vision] NVIDIA error:", res.status, errBody);

      if (res.status === 429) {
        const msg = await generateSoftError(
          "rate limited while analyzing an image",
          "okay too many requests — try again in like 30 seconds."
        );
        return NextResponse.json({ error: msg }, { status: 429 });
      }

      if (res.status === 413 || res.status === 400) {
        const msg = await generateSoftError(
          "image was too large or complex to analyze",
          "that image is too big — try a smaller one?"
        );
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      const msg = await generateSoftError(
        "vision model returned an error",
        "couldn't read that image — try another one?"
      );
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const data = await res.json();
    const rawAnalysis = data?.choices?.[0]?.message?.content;

    if (!rawAnalysis) {
      console.error(
        "[HER Vision] Unexpected response shape:",
        JSON.stringify(data).slice(0, 300)
      );
      const emptyMsg = await generateSoftError(
        "vision model returned empty analysis",
        "got nothing from that image somehow — try again?"
      );
      return NextResponse.json({ error: emptyMsg }, { status: 502 });
    }

    // ── Step 2: Rewrite raw analysis in HER's voice via Mistral ──
    console.log(
      `[HER Vision] Raw analysis (${rawAnalysis.length} chars) → rewriting in HER's voice…`
    );
    // Debug log — not user-facing
    console.debug("[HER Vision] Raw analysis:", rawAnalysis.slice(0, 400));

    let herResponse: string;
    try {
      const refinementMessages = buildVisionRefinementMessages(
        userPrompt,
        rawAnalysis
      );
      herResponse = await nvidiaChat(refinementMessages, {
        maxTokens: 512,
        temperature: 0.75,
        topP: 0.95,
      });
    } catch (refineErr) {
      // Rewrite failed — choose fallback based on question type
      console.warn(
        "[HER Vision] Rewrite step failed:",
        refineErr instanceof Error ? refineErr.message : refineErr
      );
      if (isSubjectiveVisionQuestion(userPrompt)) {
        // Subjective question: never dump raw CV output — use a context-aware HER-style fallback
        herResponse = await generateDynamicVisionFallback(userPrompt, rawAnalysis);
        console.log("[HER Vision] Subjective question — using dynamic warm fallback");
      } else {
        // Literal/objective question: raw analysis is acceptable as fallback
        herResponse = rawAnalysis;
        console.log("[HER Vision] Objective question — falling back to raw analysis");
      }
    }

    console.log("[HER Vision] Pipeline complete");
    console.debug("[HER Vision] HER response:", herResponse.slice(0, 200));

    return NextResponse.json({ message: herResponse.trim() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[HER Vision] Error:", msg);

    const fallbackMsg = await generateSoftError(
      "unexpected error during image analysis",
      "couldn't read that image — try another one?"
    );
    return NextResponse.json({ error: fallbackMsg }, { status: 502 });
  }
}
