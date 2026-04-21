/**
 * debug — Lightweight, no-op-in-production logger.
 *
 * Why this exists:
 *   - We want diagnostic logging in dev (memory pipeline, temporal events,
 *     vision pipeline, cron jobs) without paying the cost in production.
 *   - Vercel function logs count toward retention quota; a chatty server
 *     burns through it fast.
 *   - Some old `console.log` calls leaked snippets of user content (memory
 *     context, push message bodies, intent summaries). Routing them through
 *     `debug()` ensures they vanish in prod, period.
 *
 * Usage:
 *   import { debug, debugWarn } from "@/lib/debug";
 *   debug("[HER Memory]", "Saved", count, "facts");        // dev only
 *   debugWarn("[HER Push]", "Subscription expired");       // dev only
 *
 * For genuine errors that should ALWAYS surface (failures, 500s, etc.),
 * keep using `console.error` directly — those are signal, not noise.
 */

const isDev = process.env.NODE_ENV !== "production";

/** Verbose info — silent in production. */
export function debug(...args: unknown[]): void {
  if (isDev) console.log(...args);
}

/** Warnings — silent in production. Use console.error for hard failures. */
export function debugWarn(...args: unknown[]): void {
  if (isDev) console.warn(...args);
}
