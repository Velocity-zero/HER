import { NextRequest, NextResponse } from "next/server";
import { EdgeTTS } from "edge-tts-universal";
import { processSpeechText } from "@/lib/voice-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cache for synthesized audio buffers to avoid duplicate requests for identical sentences.
 * Key: voice:rate:pitch:volume:cleanedText
 */
const audioCache = new Map<string, { buffer: Uint8Array; timestamp: number }>();
const MAX_CACHE_ENTRIES = 200;

function getCacheKey(voice: string, rate: string, pitch: string, volume: string, text: string): string {
  return `${voice}|${rate}|${pitch}|${volume}|${text}`;
}

function getFromCache(key: string): Uint8Array | null {
  const entry = audioCache.get(key);
  if (!entry) return null;
  // Move to end for LRU behavior
  audioCache.delete(key);
  audioCache.set(key, entry);
  return entry.buffer;
}

function addToCache(key: string, buffer: Uint8Array): void {
  if (audioCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = audioCache.keys().next().value;
    if (firstKey) audioCache.delete(firstKey);
  }
  audioCache.set(key, { buffer, timestamp: Date.now() });
}

/**
 * Strips markdown, URLs, code blocks, and emojis so synthesized speech sounds natural.
 */
export function cleanTextForSpeech(input: string): string {
  if (!input) return "";

  return input
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, " ")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove raw URLs
    .replace(/https?:\/\/\S+/g, "")
    // Remove bold/italics
    .replace(/(\*\*|\*|__|_)(.*?)\1/g, "$2")
    // Remove markdown headers, list bullets, quotes at start of line
    .replace(/^[#>\s*-]+/gm, " ")
    // Remove emojis
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
      ""
    )
    // Normalize punctuation ellipsis
    .replace(/\.{3,}/g, "...")
    // Collapse excess whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Supported Edge Neural voices */
export const ALLOWED_VOICES: Record<string, string> = {
  "ava": "en-US-AvaMultilingualNeural",
  "jenny": "en-US-JennyNeural",
  "emma": "en-US-EmmaNeural",
  "aria": "en-US-AriaNeural",
  "brian": "en-US-BrianMultilingualNeural",
  "en-US-AvaMultilingualNeural": "en-US-AvaMultilingualNeural",
  "en-US-JennyNeural": "en-US-JennyNeural",
  "en-US-EmmaNeural": "en-US-EmmaNeural",
  "en-US-AriaNeural": "en-US-AriaNeural",
  "en-US-BrianMultilingualNeural": "en-US-BrianMultilingualNeural",
};

export const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";
export const FALLBACK_VOICE = "en-US-JennyNeural";

/**
 * POST /api/tts
 * Body: { text: string, voice?: string, rate?: string, pitch?: string }
 * Returns audio/mpeg binary stream
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawText = body.text;
    const requestedVoice = body.voice || DEFAULT_VOICE;
    const baseRate = body.rate || "+0%";
    const basePitch = body.pitch || "+0Hz";

    if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
      return NextResponse.json(
        { error: "Text is required for speech synthesis" },
        { status: 400 }
      );
    }

    // Process emotional style tags and realistic paralinguistics
    const processed = processSpeechText(rawText, baseRate, basePitch);
    const rate = processed.rate;
    const pitch = processed.pitch;
    const volume = processed.volume;

    const clean = cleanTextForSpeech(processed.cleanText);
    if (!clean) {
      return NextResponse.json(
        { error: "Text contained only symbols/formatting" },
        { status: 400 }
      );
    }

    // Limit chunk length to prevent abuse (sentences shouldn't exceed 1200 chars)
    const textToSynthesize = clean.slice(0, 1200);

    const voice = ALLOWED_VOICES[requestedVoice] || DEFAULT_VOICE;
    const cacheKey = getCacheKey(voice, rate, pitch, volume, textToSynthesize);

    // Check memory cache
    const cached = getFromCache(cacheKey);
    if (cached) {
      return new Response(cached as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
          "X-Audio-Cache": "HIT",
        },
      });
    }

    // Synthesize using primary voice
    let audioBuffer: Uint8Array | null = null;
    try {
      const tts = new EdgeTTS(textToSynthesize, voice, { rate, pitch, volume });
      const result = await tts.synthesize();
      if (result && result.audio) {
        audioBuffer = new Uint8Array(await result.audio.arrayBuffer());
      }
    } catch (primaryErr) {
      console.warn(`[TTS] Primary voice (${voice}) failed, trying fallback (${FALLBACK_VOICE}):`, primaryErr);
      if (voice !== FALLBACK_VOICE) {
        try {
          const fallbackTts = new EdgeTTS(textToSynthesize, FALLBACK_VOICE, { rate, pitch, volume });
          const result = await fallbackTts.synthesize();
          if (result && result.audio) {
            audioBuffer = new Uint8Array(await result.audio.arrayBuffer());
          }
        } catch (fallbackErr) {
          console.error("[TTS] Fallback voice also failed:", fallbackErr);
        }
      }
    }

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json(
        { error: "Failed to synthesize speech" },
        { status: 502 }
      );
    }

    // Store in cache
    addToCache(cacheKey, audioBuffer);

    return new Response(audioBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Audio-Cache": "MISS",
      },
    });
  } catch (err) {
    console.error("[TTS Route Error]:", err);
    return NextResponse.json(
      { error: "Internal error in speech synthesis" },
      { status: 500 }
    );
  }
}
