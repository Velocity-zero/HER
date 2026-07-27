/**
 * HER — NVIDIA Build Fallback LLM Provider
 *
 * Implements ChatProvider using NVIDIA NIM API (llama-3.3-nemotron-super-49b-v1.5).
 */

import { ModelMessage } from "../types";
import { ChatProvider, ProviderCapabilities, ProviderOptions } from "./types";

export const DEFAULT_NVIDIA_CHAT_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export class NvidiaProvider implements ChatProvider {
  public providerName = "nvidia";
  public capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsVision: false,
    supportsJsonMode: true,
    supportsReasoning: false,
    supportsFunctionCalling: true,
    supportsToolUse: true,
  };

  public get modelName(): string {
    return process.env.NVIDIA_CHAT_MODEL || DEFAULT_NVIDIA_CHAT_MODEL;
  }

  public get baseUrl(): string {
    const raw = process.env.NVIDIA_BASE_URL || DEFAULT_NVIDIA_BASE_URL;
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }

  private getApiKey(): string {
    const key = process.env.NVIDIA_CHAT_API_KEY || process.env.NVIDIA_API_KEY;
    if (!key || key === "your_chat_key_here" || key === "your_image_key_here") {
      throw new Error("Missing NVIDIA_CHAT_API_KEY. Please set it in .env.local.");
    }
    return key;
  }

  public async generate(
    messages: ModelMessage[],
    options: ProviderOptions = {}
  ): Promise<string> {
    const apiKey = this.getApiKey();
    const endpoint = `${this.baseUrl}/chat/completions`;
    const maxAttempts = 2;
    const timeoutMs = 60_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.modelName,
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
          console.error(`[NVIDIA] HTTP ${res.status}:`, errBody);
          if (res.status === 429) throw new Error("429 Too Many Requests");
          if (res.status === 401 || res.status === 403) throw new Error(`Auth failure (${res.status})`);
          throw new Error(`NVIDIA API error (${res.status})`);
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;

        if (!text) {
          throw new Error("NVIDIA returned an empty response");
        }

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
            (err.message.includes("empty response") || err.message.includes("500") || err.message.includes("503")));

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
    const maxAttempts = 2;
    const timeoutMs = 60_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.modelName,
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
          console.error(`[NVIDIA] Stream HTTP ${res.status}:`, errBody);
          if (res.status === 429) throw new Error("429 Too Many Requests");
          if (res.status === 401 || res.status === 403) throw new Error(`Auth failure (${res.status})`);
          throw new Error(`NVIDIA Stream API error (${res.status})`);
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
            (err.message.includes("zero chunks") || err.message.includes("500") || err.message.includes("503")));

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
