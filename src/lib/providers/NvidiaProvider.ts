/**
 * HER — NVIDIA Build LLM Provider
 *
 * Implements ChatProvider using NVIDIA NIM API with master key support
 * and automatic free-endpoint model selection & failover.
 */

import { ModelMessage } from "../types";
import { ChatProvider, ProviderCapabilities, ProviderOptions } from "./types";

/**
 * Curated list of verified NVIDIA NIM models with active free endpoints.
 * Order reflects quality, latency, and conversational ability:
 * 1. meta/llama-3.2-11b-vision-instruct (Fast, ~900ms, multimodal, streaming)
 * 2. nvidia/nemotron-3-nano-omni-30b-a3b-reasoning (Active 30B reasoning)
 * 3. nvidia/nemotron-3.5-lightning-30b-a3b (Fast 30B lightning)
 * 4. google/diffusiongemma-26b-a4b-it (Instruct-tuned Gemma)
 * 5. nvidia/nemotron-3-super-120b-a12b (High-parameter Nemotron)
 * 6. nvidia/nemotron-3-ultra-550b-a55b (Deep reasoning Nemotron)
 * 7. meta/llama-3.2-90b-vision-instruct (90B high-capacity vision)
 */
export const RECOMMENDED_NVIDIA_CHAT_MODELS = [
  "meta/llama-3.2-11b-vision-instruct",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "google/diffusiongemma-26b-a4b-it",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "meta/llama-3.2-90b-vision-instruct",
];

export const DEFAULT_NVIDIA_CHAT_MODEL = RECOMMENDED_NVIDIA_CHAT_MODELS[0];
export const NVIDIA_CHAT_MODEL = DEFAULT_NVIDIA_CHAT_MODEL;
export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export class NvidiaProvider implements ChatProvider {
  public providerName = "nvidia";
  public capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsFunctionCalling: true,
    supportsToolUse: true,
  };

  private activeModelOverride: string | null = null;
  private failedModels: Set<string> = new Set();

  public get modelName(): string {
    if (this.activeModelOverride) return this.activeModelOverride;
    const envModel = process.env.NVIDIA_CHAT_MODEL;
    if (envModel && !this.failedModels.has(envModel)) return envModel;

    for (const candidate of RECOMMENDED_NVIDIA_CHAT_MODELS) {
      if (!this.failedModels.has(candidate)) return candidate;
    }
    return DEFAULT_NVIDIA_CHAT_MODEL;
  }

  public get baseUrl(): string {
    const raw = process.env.NVIDIA_BASE_URL || DEFAULT_NVIDIA_BASE_URL;
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }

  /**
   * Resolves the API key using master key fallback:
   * 1. NVIDIA_API_KEY (master key)
   * 2. NVIDIA_CHAT_API_KEY
   * 3. NVIDIA_IMAGE_API_KEY
   */
  private getApiKey(): string {
    const key =
      process.env.NVIDIA_API_KEY ||
      process.env.NVIDIA_CHAT_API_KEY ||
      process.env.NVIDIA_IMAGE_API_KEY;

    if (!key || key.startsWith("your_")) {
      throw new Error("Missing NVIDIA_API_KEY. Please set it in .env.local.");
    }
    return key;
  }

  /**
   * Switch to next available model when current model returns 404/deprecated.
   */
  private switchNextModel(failedModel: string): string | null {
    this.failedModels.add(failedModel);
    for (const candidate of RECOMMENDED_NVIDIA_CHAT_MODELS) {
      if (!this.failedModels.has(candidate)) {
        this.activeModelOverride = candidate;
        console.warn(
          `[NVIDIA Auto-Failover] Model "${failedModel}" unavailable. Automatically switched to "${candidate}".`
        );
        return candidate;
      }
    }
    return null;
  }

  public async generate(
    messages: ModelMessage[],
    options: ProviderOptions = {}
  ): Promise<string> {
    const apiKey = this.getApiKey();
    const endpoint = `${this.baseUrl}/chat/completions`;
    const maxAttempts = 3;
    const timeoutMs = 60_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentModel = this.modelName;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: currentModel,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: options.max_tokens ?? 2048,
            temperature: options.temperature ?? 0.7,
            top_p: options.top_p ?? 0.9,
            frequency_penalty: options.frequency_penalty ?? 0,
            presence_penalty: options.presence_penalty ?? 0,
            stream: false,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(`[NVIDIA] HTTP ${res.status} (${currentModel}):`, errBody);

          if (res.status === 404 || errBody.toLowerCase().includes("not found")) {
            const nextModel = this.switchNextModel(currentModel);
            if (nextModel && attempt < maxAttempts) {
              continue;
            }
          }

          if (res.status === 429) throw new Error("429 Too Many Requests");
          if (res.status === 401 || res.status === 403) throw new Error(`Auth failure (${res.status})`);
          throw new Error(`NVIDIA API error (${res.status}): ${errBody.slice(0, 150)}`);
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;

        if (!text) {
          throw new Error("NVIDIA returned an empty response");
        }

        // Successfully generated with this model
        this.activeModelOverride = currentModel;
        return text;
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.name === "TimeoutError" ||
            err.message.includes("aborted") ||
            err.message.includes("timeout"));
        const isRetryable =
          isTimeout ||
          (err instanceof Error &&
            (err.message.includes("empty response") ||
              err.message.includes("500") ||
              err.message.includes("503") ||
              err.message.includes("404")));

        if (isRetryable && attempt < maxAttempts) {
          console.warn(`[NVIDIA] Attempt ${attempt} failed (${(err as Error).message}), retrying...`);
          continue;
        }
        throw err;
      }
    }

    throw new Error("NVIDIA provider failed after retries");
  }

  public async *stream(
    messages: ModelMessage[],
    options: ProviderOptions = {}
  ): AsyncGenerator<string> {
    const apiKey = this.getApiKey();
    const endpoint = `${this.baseUrl}/chat/completions`;
    const maxAttempts = 3;
    const timeoutMs = 60_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentModel = this.modelName;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: currentModel,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: options.max_tokens ?? 2048,
            temperature: options.temperature ?? 0.7,
            top_p: options.top_p ?? 0.9,
            frequency_penalty: options.frequency_penalty ?? 0,
            presence_penalty: options.presence_penalty ?? 0,
            stream: true,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(`[NVIDIA] Stream HTTP ${res.status} (${currentModel}):`, errBody);

          if (res.status === 404 || errBody.toLowerCase().includes("not found")) {
            const nextModel = this.switchNextModel(currentModel);
            if (nextModel && attempt < maxAttempts) {
              continue;
            }
          }

          if (res.status === 429) throw new Error("429 Too Many Requests");
          if (res.status === 401 || res.status === 403) throw new Error(`Auth failure (${res.status})`);
          throw new Error(`NVIDIA Stream API error (${res.status}): ${errBody.slice(0, 150)}`);
        }

        if (!res.body) {
          throw new Error("NVIDIA returned no response body");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let chunksEmitted = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const dataStr = trimmed.slice(6).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                chunksEmitted++;
                yield delta;
              }
            } catch {
              // Skip
            }
          }
        }

        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (delta) {
                  chunksEmitted++;
                  yield delta;
                }
              } catch {
                // Skip
              }
            }
          }
        }

        if (chunksEmitted > 0) {
          this.activeModelOverride = currentModel;
          return;
        }

        throw new Error("NVIDIA stream completed with zero chunks");
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.name === "TimeoutError" ||
            err.message.includes("aborted") ||
            err.message.includes("timeout"));
        const isRetryable =
          isTimeout ||
          (err instanceof Error &&
            (err.message.includes("zero chunks") ||
              err.message.includes("500") ||
              err.message.includes("503") ||
              err.message.includes("404")));

        if (isRetryable && attempt < maxAttempts) {
          console.warn(`[NVIDIA] Stream attempt ${attempt} failed (${(err as Error).message}), retrying...`);
          continue;
        }
        throw err;
      }
    }

    throw new Error("NVIDIA provider failed after retries");
  }
}
