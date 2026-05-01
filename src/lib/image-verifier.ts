/**
 * HER — Image Quality Verifier
 *
 * Uses the NVIDIA vision model (Gemma 3 27B) to inspect generated images
 * before they are shown to the user. Returns a quality score and a list
 * of detected issues.
 *
 * Score 0–10:
 *   ≥ threshold (default 6.5) → pass
 *   < threshold               → fail (trigger retry or soft caption)
 *
 * Configure the threshold via env: IMAGE_VERIFIER_THRESHOLD=7.0
 */

import type { VerifierResult } from "./types";

const NVIDIA_VISION_URL =
  process.env.NVIDIA_VISION_URL ??
  "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_VISION_MODEL =
  process.env.NVIDIA_VISION_MODEL ?? "google/gemma-3-27b-it";
const DEFAULT_THRESHOLD = 6.5;
const VISION_TIMEOUT_MS = parseInt(
  process.env.IMAGE_VERIFIER_TIMEOUT_MS ?? "15000",
  10
);

function getThreshold(): number {
  const raw = process.env.IMAGE_VERIFIER_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  const val = parseFloat(raw);
  return Number.isFinite(val) ? val : DEFAULT_THRESHOLD;
}

const VERIFIER_SYSTEM = `You are a strict image quality inspector for an AI companion chat app.

Analyze the image and score its quality for display in a mobile chat interface.

Check for these defects:
- Extra, missing, or malformed hands/fingers ("extra_hands")
- Distorted, blurry, or uncanny face ("blurry_face")
- Heavy pixelation or compression artifacts ("pixelated")
- Unrealistic anatomy or body proportions ("bad_anatomy")
- Content that doesn't match what was requested ("off_topic")
- Visible watermarks, logos, or text artifacts ("watermark")
- General digital artifacts, glitches, or noise ("artifacts")

Scoring guide (0–10):
- 9–10: Excellent. No visible defects.
- 7–8: Minor issues that don't significantly impact the image.
- 5–6: Noticeable defects but the image is still usable.
- 3–4: Significant problems that hurt the experience.
- 0–2: Severe defects — should not be shown.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "score": number (0 to 10),
  "issues": string[] (empty array if none),
  "notes": string (brief summary, "none" if no issues)
}`;

/**
 * Inspect a generated image using the NVIDIA vision model.
 * Returns a VerifierResult with score, pass/fail, and detected issues.
 *
 * Fails gracefully: if the vision API is unavailable or returns an error,
 * returns a passing default so image delivery is never blocked by verifier outage.
 */
export async function verifyImage(imageDataUrl: string): Promise<VerifierResult> {
  const threshold = getThreshold();

  // Soft default: pass if verifier is unavailable.
  // `skipped: true` so callers can distinguish a real pass from a fallback.
  const passthrough: VerifierResult = {
    score: -1,
    pass: true,
    issues: [],
    notes: "verifier unavailable — defaulting to pass",
    skipped: true,
  };

  const apiKey = process.env.NVIDIA_VISION_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) {
    console.warn("[HER Verifier] NVIDIA_VISION_API_KEY not set — skipping verification");
    return passthrough;
  }

  try {
    const res = await fetch(NVIDIA_VISION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_VISION_MODEL,
        messages: [
          { role: "system", content: VERIFIER_SYSTEM },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Inspect this image and return the quality JSON. No markdown.",
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl },
              },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0.1,
        stream: false,
      }),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn("[HER Verifier] Vision API returned", res.status);
      return passthrough;
    }

    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return passthrough;

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\n?|^```\n?|\n?```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as {
      score: number;
      issues: string[];
      notes: string;
    };

    if (typeof parsed.score !== "number") return passthrough;

    const result: VerifierResult = {
      score: Math.max(0, Math.min(10, parsed.score)),
      pass: parsed.score >= threshold,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };

    console.log(
      `[HER Verifier] score=${result.score} pass=${result.pass} ` +
        `issues=[${result.issues.join(", ")}]`
    );

    return result;
  } catch (err) {
    console.warn(
      "[HER Verifier] Error:",
      err instanceof Error ? err.message : err
    );
    return passthrough;
  }
}
