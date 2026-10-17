import type { TTSModelProvider, TTSSynthesizeOptions } from "./types";
import { EdgeTTSProvider } from "./providers/edge-tts-provider";
import { LocalWebGPUTTSProvider } from "./providers/local-webgpu-provider";

/**
 * TTSManager — Central Orchestrator & Registry for Voice Models.
 * Decouples the VoicePlayer / Phone Call UI architecture from the underlying TTS engines.
 */
export class TTSManager {
  private static instance: TTSManager | null = null;
  private providers: Map<string, TTSModelProvider> = new Map();
  private activeProviderId: string = "edge-neural";

  private constructor() {
    // Register default providers
    this.registerProvider(new EdgeTTSProvider());
    this.registerProvider(new LocalWebGPUTTSProvider());
  }

  public static getInstance(): TTSManager {
    if (!TTSManager.instance) {
      TTSManager.instance = new TTSManager();
    }
    return TTSManager.instance;
  }

  /**
   * Registers a new or custom TTS Model Provider (e.g. Chatterbox-Nano, Kokoro, Fish Audio)
   */
  public registerProvider(provider: TTSModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Sets the active TTS provider
   */
  public setActiveProvider(providerId: string): boolean {
    if (this.providers.has(providerId)) {
      this.activeProviderId = providerId;
      return true;
    }
    return false;
  }

  /**
   * Returns all available providers
   */
  public getProviders(): TTSModelProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Returns the currently active provider
   */
  public getActiveProvider(): TTSModelProvider {
    return this.providers.get(this.activeProviderId) || this.providers.get("edge-neural")!;
  }

  /**
   * Synthesize text to audio using the active provider with automatic fallback
   */
  public async synthesize(
    text: string,
    options: TTSSynthesizeOptions,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    const active = this.getActiveProvider();
    let audio = await active.synthesize(text, options, signal);

    // Fallback to Edge Neural if secondary/Option A provider produced null
    if (!audio && active.id !== "edge-neural" && !signal?.aborted) {
      const fallback = this.providers.get("edge-neural");
      if (fallback) {
        audio = await fallback.synthesize(text, options, signal);
      }
    }

    return audio;
  }

  /**
   * Unlocks audio contexts on active providers
   */
  public async unlockAudio(): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.unlockAudio) {
        await provider.unlockAudio().catch(() => {});
      }
    }
  }
}

export const ttsManager = TTSManager.getInstance();
