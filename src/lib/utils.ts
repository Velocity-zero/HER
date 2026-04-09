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

/**
 * Authenticated fetch wrapper — injects the Supabase JWT Bearer token
 * into the Authorization header of every API call.
 *
 * Usage:
 *   const res = await authFetch("/api/chat", { method: "POST", ... }, session);
 *
 * When session is null (guest mode / Supabase not configured), calls proceed
 * without the header — the API routes handle this by allowing guest mode.
 */
export function authFetch(
  url: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(url, { ...init, headers });
}
