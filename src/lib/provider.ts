/**
 * HER — Provider-Agnostic LLM Entry Point
 *
 * This file isolates all LLM provider logic. The API route calls
 * generateReply() or generateStreamReply(). The provider router handles the rest.
 *
 * HER itself never knows or cares which model/provider is active.
 *
 * Step — Provider-Agnostic LLM Router (OpenCode Zen Primary + NVIDIA Fallback)
 */

import { ModelMessage } from "./types";
import { router, isIncompleteSentence as routerIsIncomplete, formatMigrationAuditLog as routerFormatAudit } from "./providers/Router";
import { DEFAULT_NVIDIA_CHAT_MODEL, DEFAULT_NVIDIA_BASE_URL } from "./providers/NvidiaProvider";
import { ExtendedAuditParams } from "./providers/types";

// ── Backward-Compatible Constants & Types ──────────────────

export const NVIDIA_CHAT_URL = `${DEFAULT_NVIDIA_BASE_URL}/chat/completions`;
export const NVIDIA_CHAT_MODEL = DEFAULT_NVIDIA_CHAT_MODEL;

export type AuditParams = ExtendedAuditParams;

export const isIncompleteSentence = routerIsIncomplete;
export const formatMigrationAuditLog = routerFormatAudit;

// ── Public Entry Points ────────────────────────────────────

/**
 * Generate HER's reply using the Provider Router.
 *
 * Tries Primary Provider (OpenCode Zen), automatically falls back
 * to Secondary Provider (NVIDIA Build) if primary fails.
 */
export async function generateReply(messages: ModelMessage[]): Promise<string> {
  return router.generate(messages);
}

/**
 * Generate HER's reply as a stream of text chunks using the Provider Router.
 */
export async function* generateStreamReply(
  messages: ModelMessage[]
): AsyncGenerator<string> {
  yield* router.stream(messages);
}
