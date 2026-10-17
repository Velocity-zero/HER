import type { TTSModelProvider, TTSSynthesizeOptions } from "../types";

/**
 * EdgeTTSProvider — Primary Cloud Neural HD Voice Engine.
 * Fetches from Next.js /api/tts endpoint with automated server fallback.
 */
export class EdgeTTSProvider implements TTSModelProvider {
  public readonly id = "edge-neural";
  public readonly name = "Microsoft Edge Neural HD";
  public readonly type = "cloud";

  public async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined";
  }

  public async synthesize(
    text: string,
    options: TTSSynthesizeOptions,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: options.voice || "en-US-AvaMultilingualNeural",
          rate: options.rate || "+0%",
          pitch: options.pitch || "+0Hz",
          volume: options.volume || "+0%",
        }),
        signal,
      });

      if (!res.ok) {
        throw new Error(`TTS HTTP error: ${res.status}`);
      }

      return await res.arrayBuffer();
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        return null;
      }
      console.warn("[EdgeTTSProvider] Synthesis failed:", err);
      return null;
    }
  }
}
