/**
 * HER — AI Provider (NVIDIA NIM / Qwen3-Next-80B-A3B-Instruct)
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
  "qwen/qwen3-next-80b-a3b-instruct";

/** Timeout for NVIDIA API calls (ms). Covers cold-start latency. */
const NVIDIA_TIMEOUT_MS = 60_000;

// ── Diagnostic & Audit Helpers ─────────────────────────────

export interface AuditParams {
  provider: string;
  model: string;
  promptChars: number;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  latencyMs: number;
  chunks: number;
  chunksExpected?: number;
  finalChars: number;
  last100Chars: string;
  isIncomplete: boolean;
}

/**
 * Diagnostic check: flags whether text ends on dangling tokens/conjunctions
 * or lacks terminal punctuation (used FOR LOGGING ONLY — never blocks persistence).
 */
export function isIncompleteSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Terminal punctuation or closing quote/bracket → likely complete
  if (/[.!?~:;}"'’`»\]\)]$/.test(trimmed)) return false;

  // Common trailing words that strongly indicate a sentence cut off mid-thought
  const trailingDanglingRegex = /\b(the|and|because|when|while|if|or|of|to|with|in|a|an|for|on|at|by|from|about|burn the)$/i;
  if (trailingDanglingRegex.test(trimmed)) return true;

  // Non-punctuated trailing word of length > 20 chars (e.g. cut off mid-word)
  const lastWord = trimmed.split(/\s+/).pop() || "";
  return lastWord.length > 20;
}

/** Format single structured migration audit log block */
export function formatMigrationAuditLog(params: AuditParams): string {
  return [
    "=================================",
    "[HER MIGRATION AUDIT]",
    `Provider: ${params.provider}`,
    `Model: ${params.model}`,
    `Prompt chars: ${params.promptChars}`,
    `Prompt tokens (approx): ${params.promptTokens}`,
    `Completion tokens: ${params.completionTokens}`,
    `Finish reason: ${params.finishReason}`,
    `Latency: ${params.latencyMs}ms`,
    `SSE Chunks Received: ${params.chunks}`,
    `SSE Chunks Expected: ${params.chunksExpected ?? params.chunks}`,
    `Final chars: ${params.finalChars}`,
    `Last 100 chars: "${params.last100Chars.replace(/\n/g, " ")}"`,
    `Incomplete sentence flag: ${params.isIncomplete}`,
    "=================================",
  ].join("\n");
}

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
  const startTime = Date.now();

  const promptChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const promptTokens = Math.ceil(promptChars / 4);

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
          max_tokens: 2048,
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0,
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

      if (process.env.HER_PROVIDER_DEBUG === "true") {
        console.log("[HER LLM] Raw provider response:", JSON.stringify(data));
      }

      const text = data?.choices?.[0]?.message?.content;
      const finishReason = data?.choices?.[0]?.finish_reason || "unknown";
      const completionTokens = data?.usage?.completion_tokens || Math.ceil((text?.length || 0) / 4);

      if (!text) {
        throw new Error("NVIDIA returned an empty response");
      }

      if (finishReason !== "stop") {
        console.warn(`[HER LLM] finish_reason != stop (${finishReason})`);
      }

      const latencyMs = Date.now() - startTime;
      const incompleteFlag = isIncompleteSentence(text);

      const { logPipelineStage } = await import("./pipeline-logger");
      logPipelineStage("LLM Provider (Raw Non-Stream)", text);

      const auditLog = formatMigrationAuditLog({
        provider: "NVIDIA NIM",
        model: NVIDIA_CHAT_MODEL,
        promptChars,
        promptTokens,
        completionTokens,
        finishReason,
        latencyMs,
        chunks: 1,
        finalChars: text.length,
        last100Chars: text.slice(-100),
        isIncomplete: incompleteFlag,
      });

      if (process.env.HER_MIGRATION_DEBUG === "true" || process.env.NODE_ENV === "development") {
        console.log(auditLog);
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
  const startTime = Date.now();

  const promptChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const promptTokens = Math.ceil(promptChars / 4);

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
          max_tokens: 2048,
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0,
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
      let fullText = "";
      let lastFinishReason = "unknown";
      let reportedCompletionTokens = 0;

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

          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") {
            if (process.env.HER_PROVIDER_DEBUG === "true") {
              console.log("[HER LLM] SSE stream received [DONE]");
            }
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            if (process.env.HER_PROVIDER_DEBUG === "true") {
              console.log("[HER LLM] Raw SSE chunk:", JSON.stringify(parsed));
            }

            const choice = parsed?.choices?.[0];
            if (choice?.finish_reason) {
              lastFinishReason = choice.finish_reason;
            }

            if (parsed?.usage?.completion_tokens) {
              reportedCompletionTokens = parsed.usage.completion_tokens;
            }

            const delta = choice?.delta?.content;
            if (delta) {
              fullText += delta;
              chunksEmitted++;
              if (process.env.HER_PROVIDER_DEBUG === "true" || process.env.HER_MIGRATION_DEBUG === "true") {
                console.log(
                  `[HER SSE CHUNK] chunk_number=${chunksEmitted} chunk_length=${delta.length} running_total=${fullText.length} finished=${!!choice?.finish_reason}`
                );
              }
              yield delta;
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
          const dataStr = trimmed.slice(6).trim();
          if (dataStr !== "[DONE]") {
            try {
              const parsed = JSON.parse(dataStr);
              const choice = parsed?.choices?.[0];
              if (choice?.finish_reason) {
                lastFinishReason = choice.finish_reason;
              }
              const delta = choice?.delta?.content;
              if (delta) {
                fullText += delta;
                chunksEmitted++;
                if (process.env.HER_PROVIDER_DEBUG === "true" || process.env.HER_MIGRATION_DEBUG === "true") {
                  console.log(
                    `[HER SSE CHUNK] chunk_number=${chunksEmitted} chunk_length=${delta.length} running_total=${fullText.length} finished=${!!choice?.finish_reason}`
                  );
                }
                yield delta;
              }
            } catch {
              // Skip
            }
          }
        }
      }

      if (chunksEmitted > 0) {
        if (lastFinishReason !== "stop") {
          console.warn(`[HER LLM] Stream ended with finish_reason != stop (${lastFinishReason})`);
        }

        const { logPipelineStage } = await import("./pipeline-logger");
        logPipelineStage("LLM Provider (Stream Full Text)", fullText);
        logPipelineStage("SSE Parser (Chunk Assembly)", fullText);

        const latencyMs = Date.now() - startTime;
        const completionTokens = reportedCompletionTokens || Math.ceil(fullText.length / 4);
        const incompleteFlag = isIncompleteSentence(fullText);

        const auditLog = formatMigrationAuditLog({
          provider: "NVIDIA NIM",
          model: NVIDIA_CHAT_MODEL,
          promptChars,
          promptTokens,
          completionTokens,
          finishReason: lastFinishReason,
          latencyMs,
          chunks: chunksEmitted,
          finalChars: fullText.length,
          last100Chars: fullText.slice(-100),
          isIncomplete: incompleteFlag,
        });

        if (process.env.HER_MIGRATION_DEBUG === "true" || process.env.NODE_ENV === "development") {
          console.log(auditLog);
        }

        return;
      }

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

  throw new Error("NVIDIA provider failed after retries");
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
