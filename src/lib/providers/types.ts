/**
 * HER — Provider-Agnostic LLM Router Interfaces & Types
 */

import { ModelMessage } from "../types";

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  supportsReasoning: boolean;
  supportsFunctionCalling: boolean;
  supportsToolUse: boolean;
}

export interface ProviderOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  chat_template_kwargs?: Record<string, unknown>;
  stream?: boolean;
}

export interface ChatProvider {
  /** Identifier of the provider (e.g. "opencode", "nvidia") */
  providerName: string;

  /** Model identifier currently used by this provider */
  modelName: string;

  /** Operational capabilities exposed by this provider */
  capabilities: ProviderCapabilities;

  /** Non-streaming text completion */
  generate(messages: ModelMessage[], options?: ProviderOptions): Promise<string>;

  /** Streaming text completion yielding chunks */
  stream(messages: ModelMessage[], options?: ProviderOptions): AsyncGenerator<string>;
}

export interface ProviderHealthState {
  healthy: boolean;
  lastFailure?: number;
  failureCount: number;
  averageLatency: number;
  lastSuccess?: number;
}

export interface ExtendedAuditParams {
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
  fallbackUsed?: boolean;
  providerLatency?: number;
  providerRetries?: number;
  providerSwitchReason?: string;
}
