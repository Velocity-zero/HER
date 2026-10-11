/**
 * HER — Provider-Agnostic LLM Router
 *
 * Manages provider health, automatic fallback execution, and streaming normalization.
 */

import { ModelMessage } from "../types";
import { ChatProvider, ProviderHealthState, ProviderOptions, ExtendedAuditParams } from "./types";
import { OpenCodeZenProvider } from "./OpenCodeZenProvider";
import { NvidiaProvider } from "./NvidiaProvider";
import { logPipelineStage } from "../pipeline-logger";

export function isIncompleteSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[.!?~:;}"'’`»\]\)]$/.test(trimmed)) return false;
  const trailingDanglingRegex = /\b(the|and|because|when|while|if|or|of|to|with|in|a|an|for|on|at|by|from|about|burn the)$/i;
  if (trailingDanglingRegex.test(trimmed)) return true;
  const lastWord = trimmed.split(/\s+/).pop() || "";
  return lastWord.length > 20;
}

export function formatMigrationAuditLog(params: ExtendedAuditParams): string {
  return [
    "=================================",
    "[HER MIGRATION AUDIT]",
    `Provider: ${params.provider}`,
    `Model: ${params.model}`,
    `Fallback Used: ${params.fallbackUsed ?? false}`,
    `Provider Latency: ${params.providerLatency ?? params.latencyMs}ms`,
    `Switch Reason: ${params.providerSwitchReason ?? "N/A"}`,
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

export class LLMRouter {
  private providers: Map<string, ChatProvider> = new Map();
  private healthState: Map<string, ProviderHealthState> = new Map();

  constructor() {
    // Register default built-in providers
    this.registerProvider(new OpenCodeZenProvider());
    this.registerProvider(new NvidiaProvider());
  }

  /**
   * Register a new provider adapter (e.g. Gemini, Claude, OpenRouter, Ollama)
   */
  public registerProvider(provider: ChatProvider): void {
    this.providers.set(provider.providerName.toLowerCase(), provider);
    this.healthState.set(provider.providerName.toLowerCase(), {
      healthy: true,
      failureCount: 0,
      averageLatency: 0,
    });
  }

  /**
   * Clears all registered providers (useful for test isolation)
   */
  public clearProviders(): void {
    this.providers.clear();
    this.healthState.clear();
  }

  public getProvider(name: string): ChatProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  public getHealthState(name: string): ProviderHealthState | undefined {
    return this.healthState.get(name.toLowerCase());
  }

  /**
   * Returns primary and secondary fallback providers based on PRIMARY_PROVIDER env var
   */
  public resolveProviderChain(): { primary: ChatProvider; fallback: ChatProvider } {
    const rawPrimary = (process.env.PRIMARY_PROVIDER || "").toLowerCase().trim();
    const hasNvidiaKey = Boolean(
      (process.env.NVIDIA_API_KEY || process.env.NVIDIA_CHAT_API_KEY) &&
      !process.env.NVIDIA_API_KEY?.startsWith("your_")
    );
    const hasOpenCodeKey = Boolean(
      (process.env.OPENCODE_ZEN_API_KEY || process.env.OPENCODE_ZEN_KEY) &&
      !process.env.OPENCODE_ZEN_API_KEY?.startsWith("your_")
    );

    let primaryName = rawPrimary;
    if (!primaryName) {
      if (hasNvidiaKey && !hasOpenCodeKey) {
        primaryName = "nvidia";
      } else {
        primaryName = "opencode";
      }
    }

    const primary = this.providers.get(primaryName) || this.providers.get("nvidia") || Array.from(this.providers.values())[0];

    let fallbackName = primary.providerName.toLowerCase() === "opencode" ? "nvidia" : "opencode";
    if (!this.providers.has(fallbackName) || fallbackName === primary.providerName.toLowerCase()) {
      const candidates = Array.from(this.providers.keys()).filter((k) => k !== primary.providerName.toLowerCase());
      fallbackName = candidates[0] || primary.providerName.toLowerCase();
    }

    const fallback = this.providers.get(fallbackName) || Array.from(this.providers.values())[0];

    return { primary, fallback };
  }

  private updateSuccessHealth(providerName: string, latencyMs: number): void {
    const state = this.healthState.get(providerName.toLowerCase());
    if (state) {
      state.healthy = true;
      state.failureCount = 0;
      state.lastSuccess = Date.now();
      state.averageLatency = state.averageLatency === 0 ? latencyMs : Math.round((state.averageLatency + latencyMs) / 2);
    }
  }

  private updateFailureHealth(providerName: string): void {
    const state = this.healthState.get(providerName.toLowerCase());
    if (state) {
      state.failureCount += 1;
      state.lastFailure = Date.now();
      if (state.failureCount >= 3) {
        state.healthy = false;
      }
    }
  }

  public async generate(messages: ModelMessage[], options: ProviderOptions = {}): Promise<string> {
    const { primary, fallback } = this.resolveProviderChain();
    const startTime = Date.now();

    const promptChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const promptTokens = Math.ceil(promptChars / 4);

    let fallbackUsed = false;
    let switchReason = "";
    let activeProvider = primary;
    let text = "";

    try {
      if (process.env.HER_PROVIDER_DEBUG === "true") {
        console.log(`[HER ROUTER] Attempting primary provider (${primary.providerName} / ${primary.modelName})`);
      }
      text = await primary.generate(messages, options);
      this.updateSuccessHealth(primary.providerName, Date.now() - startTime);
    } catch (err) {
      switchReason = (err as Error).message;
      this.updateFailureHealth(primary.providerName);
      console.warn(
        `[HER ROUTER FALLBACK] Primary provider (${primary.providerName}) failed: ${switchReason}. Switching to fallback provider (${fallback.providerName}).`
      );

      fallbackUsed = true;
      activeProvider = fallback;
      const fallbackStart = Date.now();
      text = await fallback.generate(messages, options);
      this.updateSuccessHealth(fallback.providerName, Date.now() - fallbackStart);
    }

    const latencyMs = Date.now() - startTime;
    const incompleteFlag = isIncompleteSentence(text);

    logPipelineStage("LLM Provider (Raw Non-Stream)", text);

    const auditLog = formatMigrationAuditLog({
      provider: activeProvider.providerName,
      model: activeProvider.modelName,
      promptChars,
      promptTokens,
      completionTokens: Math.ceil(text.length / 4),
      finishReason: "stop",
      latencyMs,
      chunks: 1,
      finalChars: text.length,
      last100Chars: text.slice(-100),
      isIncomplete: incompleteFlag,
      fallbackUsed,
      providerLatency: latencyMs,
      providerSwitchReason: switchReason || undefined,
    });

    if (process.env.HER_MIGRATION_DEBUG === "true" || process.env.NODE_ENV === "development") {
      console.log(auditLog);
    }

    return text;
  }

  public async *stream(messages: ModelMessage[], options: ProviderOptions = {}): AsyncGenerator<string> {
    const { primary, fallback } = this.resolveProviderChain();
    const startTime = Date.now();

    const promptChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const promptTokens = Math.ceil(promptChars / 4);

    let fallbackUsed = false;
    let switchReason = "";
    let activeProvider = primary;
    let fullText = "";
    let chunksEmitted = 0;

    try {
      if (process.env.HER_PROVIDER_DEBUG === "true") {
        console.log(`[HER ROUTER] Starting stream on primary provider (${primary.providerName} / ${primary.modelName})`);
      }
      for await (const chunk of primary.stream(messages, options)) {
        chunksEmitted++;
        fullText += chunk;
        yield chunk;
      }
      this.updateSuccessHealth(primary.providerName, Date.now() - startTime);
    } catch (err) {
      if (chunksEmitted > 0) {
        // Stream already started emitting to client — cannot switch mid-stream without corrupting output
        this.updateFailureHealth(primary.providerName);
        throw err;
      }

      switchReason = (err as Error).message;
      this.updateFailureHealth(primary.providerName);
      console.warn(
        `[HER ROUTER FALLBACK] Primary stream (${primary.providerName}) failed: ${switchReason}. Switching to fallback stream (${fallback.providerName}).`
      );

      fallbackUsed = true;
      activeProvider = fallback;
      const fallbackStart = Date.now();

      for await (const chunk of fallback.stream(messages, options)) {
        chunksEmitted++;
        fullText += chunk;
        yield chunk;
      }
      this.updateSuccessHealth(fallback.providerName, Date.now() - fallbackStart);
    }

    if (chunksEmitted > 0) {
      logPipelineStage("LLM Provider (Stream Full Text)", fullText);
      logPipelineStage("SSE Parser (Chunk Assembly)", fullText);

      const latencyMs = Date.now() - startTime;
      const auditLog = formatMigrationAuditLog({
        provider: activeProvider.providerName,
        model: activeProvider.modelName,
        promptChars,
        promptTokens,
        completionTokens: Math.ceil(fullText.length / 4),
        finishReason: "stop",
        latencyMs,
        chunks: chunksEmitted,
        finalChars: fullText.length,
        last100Chars: fullText.slice(-100),
        isIncomplete: isIncompleteSentence(fullText),
        fallbackUsed,
        providerLatency: latencyMs,
        providerSwitchReason: switchReason || undefined,
      });

      if (process.env.HER_MIGRATION_DEBUG === "true" || process.env.NODE_ENV === "development") {
        console.log(auditLog);
      }
    }
  }
}

// Global Singleton Router Instance
export const router = new LLMRouter();
