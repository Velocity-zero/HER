/**
 * HER — Dynamic Microcopy API
 *
 * Lightweight endpoint that returns a short, model-generated
 * HER-style placeholder line for transient UI states.
 *
 * GET /api/microcopy?context=chat_thinking
 * GET /api/microcopy?context=vision_processing
 * GET /api/microcopy?context=image_generating
 * GET /api/microcopy?context=soft_error
 *
 * Returns: { text: string }
 *
 * This is a UX enhancement — callers should always have a local
 * fallback and never block on this response.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateHerMicrocopy,
  type MicrocopyContext,
} from "@/lib/multimodal";

const VALID_CONTEXTS = new Set<MicrocopyContext>([
  "chat_thinking",
  "vision_processing",
  "image_generating",
  "soft_error",
]);

export async function GET(req: NextRequest) {
  const context = req.nextUrl.searchParams.get("context") as MicrocopyContext | null;

  if (!context || !VALID_CONTEXTS.has(context)) {
    return NextResponse.json(
      { error: "Invalid context. Use: chat_thinking, vision_processing, image_generating, soft_error" },
      { status: 400 }
    );
  }

  try {
    const text = await generateHerMicrocopy(context, 600);
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ text: "…" });
  }
}
