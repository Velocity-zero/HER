/**
 * HER — Shared Utilities
 *
 * Small, pure helpers used across multiple components.
 * Extracted here to avoid duplication and keep components lean.
 */

/**
 * Detect touch-primary devices (phones/tablets with virtual keyboards).
 * Uses coarse pointer detection — reliable, no user-agent sniffing.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Human-pacing delay — brief pause so responses don't feel instant.
 * Returns a promise that resolves after a random 350–900ms.
 */
export function humanDelay(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 350 + Math.random() * 550));
}
