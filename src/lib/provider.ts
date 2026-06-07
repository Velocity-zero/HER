/**
 * HER — AI Provider (NVIDIA NIM / Llama 3.3 Nemotron Super 49B)
 *
 * This file isolates all LLM provider logic. The API route calls
 * a single function: generateReply(). The provider handles the rest.
 *
 * Provider logic is fully isolated here — the frontend never knows
 * or cares which model is being used.
 */

import { ModelMessage } from "./types";

// ── NVIDIA NIM Constants (shared with multimodal.ts) ───────

export const NVIDIA_CHAT_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_CHAT_MODEL =
  "nvidia/llama-3.3-nemotron-super-49b-v1.5";

/** Timeout for NVIDIA API calls (ms). Covers cold-start latency. */
const NVIDIA_TIMEOUT_MS = 60_000;

/** Convert ModelMessage[] to OpenAI-compatible messages for NVIDIA */
function toNvidiaMessages(
  messages: ModelMessage[]
): { role: string; content: string }[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function getNvidiaChatApiKey(): string {
  const key = process.env.NVIDIA_CHAT_API_KEY;
  if (!key || key === "your_chat_key_here") {
    throw new Error(
      "Missing NVIDIA_CHAT_API_KEY. Add it to your .env.local file."
    );
  }
  return key;
}

async function nvidiaProvider(messages: ModelMessage[]): Promise<string> {
  const apiKey = getNvidiaChatApiKey();
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(NVIDIA_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: NVIDIA_CHAT_MODEL,
          messages: toNvidiaMessages(messages),
          max_tokens: 512,
          temperature: 0.7,
          top_p: 0.95,
          frequency_penalty: 0.15,
          presence_penalty: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[NVIDIA] Non-200 response:", res.status, errBody);
        if (res.status === 429) throw new Error("429 Too Many Requests");
        throw new Error(`NVIDIA API error (${res.status})`);
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;

      if (!text) {
        throw new Error("NVIDIA returned an empty response");
      }

      return text;
    } catch (err) {
      const isTimeout = err instanceof Error && (
        err.name === "TimeoutError" ||
        err.message.includes("aborted") ||
        err.message.includes("timeout")
      );
      const isRetryable = isTimeout || (err instanceof Error && err.message.includes("empty response"));
      if (isRetryable && attempt < maxAttempts) {
        console.warn(`[NVIDIA] Attempt ${attempt} failed (${err instanceof Error ? err.message : "unknown"}), retrying...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error("NVIDIA provider failed after retries");
}

async function* nvidiaStreamProvider(
  messages: ModelMessage[]
): AsyncGenerator<string> {
  const apiKey = getNvidiaChatApiKey();
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(NVIDIA_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: NVIDIA_CHAT_MODEL,
          messages: toNvidiaMessages(messages),
          max_tokens: 512,
          temperature: 0.7,
          top_p: 0.95,
          frequency_penalty: 0.15,
          presence_penalty: 0,
          stream: true,
        }),
        signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[NVIDIA] Stream non-200 response:", res.status, errBody);
        if (res.status === 429) throw new Error("429 Too Many Requests");
        throw new Error(`NVIDIA API error (${res.status})`);
      }

      if (!res.body) {
        throw new Error("NVIDIA returned no response body");
      }

      // Parse SSE stream from NVIDIA
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chunksEmitted = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              yield delta;
              chunksEmitted++;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                yield delta;
                chunksEmitted++;
              }
            } catch {
              // Skip
            }
          }
        }
      }

      // If we got chunks, success — exit the retry loop
      if (chunksEmitted > 0) return;

      // Zero chunks but no error — treat as a failed attempt
      throw new Error("NVIDIA stream completed with zero chunks");
    } catch (err) {
      const isTimeout = err instanceof Error && (
        err.name === "TimeoutError" ||
        err.message.includes("aborted") ||
        err.message.includes("timeout")
      );
      const isRetryable = isTimeout || (err instanceof Error && err.message.includes("zero chunks"));
      if (isRetryable && attempt < maxAttempts) {
        console.warn(`[NVIDIA] Stream attempt ${attempt} failed (${err instanceof Error ? err.message : "unknown"}), retrying...`);
        continue;
      }
      throw err;
    }
  }
}

// ── Main Entry Point ───────────────────────────────────────

/**
 * Generate HER's reply using the configured provider.
 *
 * This is the ONLY function the API route needs to call.
 * The provider, model, and conversion logic are all handled here.
 */
export async function generateReply(messages: ModelMessage[]): Promise<string> {
  return nvidiaProvider(messages);
}

/**
 * Generate HER's reply as a stream of text chunks.
 */
export async function* generateStreamReply(
  messages: ModelMessage[]
): AsyncGenerator<string> {
  yield* nvidiaStreamProvider(messages);
}
