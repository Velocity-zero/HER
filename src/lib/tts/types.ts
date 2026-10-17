/**
 * TTS Architecture — Pluggable Model Provider Types
 *
 * Decouples the Voice Session / Call UI Architecture from specific TTS models.
 * Allows seamless switching between:
 * - Edge Neural Cloud (/api/tts)
 * - Option A: In-Browser WebGPU / ONNX (Chatterbox-Nano / Kokoro)
 * - Browser WebSpeech API fallback
 */

export interface TTSSynthesizeOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
}

export type TTSProviderType = "cloud" | "browser-local" | "webgpu-onnx";

export interface TTSModelProvider {
  /** Unique provider identifier */
  id: string;
  /** Human-readable provider label */
  name: string;
  /** Provider execution type */
  type: TTSProviderType;
  /** Synthesizes text to audio binary ArrayBuffer (MP3/WAV) */
  synthesize(
    text: string,
    options: TTSSynthesizeOptions,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null>;
  /** Checks if the model/engine is supported and ready in current runtime */
  isAvailable(): Promise<boolean> | boolean;
  /** Prewarms or unlocks audio pipelines if required on mobile devices */
  unlockAudio?(): Promise<void>;
}
