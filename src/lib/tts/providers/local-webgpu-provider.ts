import type { TTSModelProvider, TTSSynthesizeOptions } from "../types";

/**
 * LocalWebGPUTTSProvider — Option A Architecture for In-Browser WebGPU/ONNX Speech Synthesis.
 *
 * Dedicated decoupled provider for running lightweight voice models
 * (e.g., Chatterbox-Nano ~110M or Kokoro-82M) directly inside the client's
 * browser using WebGPU/WASM without server round-trips.
 */
export class LocalWebGPUTTSProvider implements TTSModelProvider {
  public readonly id = "webgpu-local";
  public readonly name = "Option A: Local WebGPU Engine";
  public readonly type = "webgpu-onnx";

  private isInitialized = false;

  public async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    // Check for WebGPU or WebAssembly support
    return Boolean(navigator && "gpu" in navigator) || Boolean(window.WebAssembly);
  }

  public async unlockAudio(): Promise<void> {
    // Audio context prewarming hook
  }

  public async synthesize(
    text: string,
    options: TTSSynthesizeOptions,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    // When Option A model weights are activated, this delegates to WebGPU ONNX session
    // For now, cleanly falls back if model weights are not loaded yet
    if (!this.isInitialized) {
      return null;
    }

    if (signal?.aborted) return null;
    return null;
  }
}
