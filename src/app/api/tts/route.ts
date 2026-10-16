import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
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
 * Strips markdown, URLs, code blocks, emojis, and roleplay action tags (*laughs*, [whispering])
 * so synthesized speech sounds completely natural without spelling out action directions.
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
    // Convert bold to plain text first so bold names (**Samantha**) are preserved
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // Convert human laughter and sighing cues to natural conversational spoken sounds
    .replace(/(?:\*|\[|\()\s*(?:laughs|chuckles|giggles|laughter|laughing)\s*(?:\*|\]|\))/gi, " haha ")
    .replace(/(?:\*|\[|\()\s*(?:sighs|sighing|sigh)\s*(?:\*|\]|\))/gi, " ahh... ")
    .replace(/(?:\*|\[|\()\s*(?:clears throat|throat clearing)\s*(?:\*|\]|\))/gi, " ahem... ")
    .replace(/(?:\*|\[|\()\s*(?:yawns|yawning)\s*(?:\*|\]|\))/gi, " ")
    // Strip common roleplay action verbs in asterisks e.g. *smiles*, *pauses*, *looks away*, *softly giggles*
    .replace(/\*\s*(?:smiles?|grins?|pauses?|blushes?|looks?|leans?|winks?|chuckles?|gasps?|sighs?|whispers?|nods?|gently|softly)[^*]*\*/gi, " ")
    // Strip bracketed style tags ([whispering], [calm], [warmly])
    .replace(/\[[^\]]+\]/g, " ")
    // Strip parenthetical stage directions like (softly), (whispering), (gently)
    .replace(/\((?:whispering|softly|gently|warmly|smiling|pause|laughing|calm|quietly|excited)\)/gi, " ")
    // Convert remaining single asterisks (italics) to plain words
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
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
  "emma": "en-US-EmmaMultilingualNeural",
  "aria": "en-US-AriaNeural",
  "sonia": "en-GB-SoniaNeural",
  "brian": "en-US-BrianMultilingualNeural",
  "andrew": "en-US-AndrewMultilingualNeural",
  "en-US-AvaMultilingualNeural": "en-US-AvaMultilingualNeural",
  "en-US-JennyNeural": "en-US-JennyNeural",
  "en-US-EmmaMultilingualNeural": "en-US-EmmaMultilingualNeural",
  "en-US-EmmaNeural": "en-US-EmmaMultilingualNeural",
  "en-US-AriaNeural": "en-US-AriaNeural",
  "en-GB-SoniaNeural": "en-GB-SoniaNeural",
  "en-US-BrianMultilingualNeural": "en-US-BrianMultilingualNeural",
  "en-US-AndrewMultilingualNeural": "en-US-AndrewMultilingualNeural",
};

export const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";
export const FALLBACK_VOICE = "en-US-JennyNeural";

// Concurrency queue to prevent hammering Microsoft Bing TTS WebSockets with parallel spawns
let activeTTSProcesses = 0;
const MAX_CONCURRENT_TTS = 2;
const ttsWaitQueue: (() => void)[] = [];

function acquireTTSSlot(): Promise<void> {
  if (activeTTSProcesses < MAX_CONCURRENT_TTS) {
    activeTTSProcesses++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    ttsWaitQueue.push(resolve);
  });
}

function releaseTTSSlot(): void {
  activeTTSProcesses--;
  const next = ttsWaitQueue.shift();
  if (next) {
    activeTTSProcesses++;
    next();
  }
}

/**
 * Executes official edge-tts engine via child process streaming directly to buffer.
 */
async function runEdgeTTS(
  text: string,
  voice: string,
  rate: string = "+0%",
  pitch: string = "+0Hz",
  volume: string = "+0%"
): Promise<Uint8Array | null> {
  await acquireTTSSlot();
  try {
    return await new Promise<Uint8Array | null>((resolve) => {
      const args = [
        "-m", "edge_tts",
        "-v", voice,
        "--rate", rate,
        "--pitch", pitch,
        "--volume", volume,
        "-t", text,
        "--no-progress",
      ];
      const proc = spawn("python", args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let errOutput = "";

      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        resolve(null);
      }, 30000);

      proc.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        errOutput += chunk.toString();
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        console.warn("[TTS Engine] Process spawn error:", err);
        resolve(null);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.warn("[TTS Engine] Process exited with code", code, errOutput);
          resolve(null);
          return;
        }
        const total = Buffer.concat(chunks);
        if (total.length > 0) {
          resolve(new Uint8Array(total));
        } else {
          resolve(null);
        }
      });
    });
  } finally {
    releaseTTSSlot();
  }
}

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

    // 1. Try local persistent fast TTS server first if available
    try {
      const fastRes = await fetch("http://127.0.0.1:5055/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSynthesize,
          voice,
          rate,
          pitch,
          volume,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (fastRes.ok) {
        const ab = await fastRes.arrayBuffer();
        if (ab.byteLength > 0) {
          const u8 = new Uint8Array(ab);
          addToCache(cacheKey, u8);
          return new Response(u8 as unknown as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
              "X-Audio-Cache": "FAST-SERVER",
            },
          });
        }
      }
    } catch {
      // Persistent server unavailable, fall back to direct spawn
    }

    // 2. Synthesize using primary voice via child process
    let audioBuffer = await runEdgeTTS(textToSynthesize, voice, rate, pitch, volume);
    if (!audioBuffer && voice !== FALLBACK_VOICE) {
      console.warn(`[TTS] Primary voice (${voice}) failed, trying fallback (${FALLBACK_VOICE})`);
      audioBuffer = await runEdgeTTS(textToSynthesize, FALLBACK_VOICE, rate, pitch, volume);
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

