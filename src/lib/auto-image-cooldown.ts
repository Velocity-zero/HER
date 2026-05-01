/**
 * Per-user cooldown for auto-generated images.
 *
 * Shared between /api/imagine (explicit) and /api/imagine/auto (implicit)
 * so an explicit generation suppresses the auto pipeline for the next
 * conversation turn — preventing double-fires.
 */

const USER_LAST_IMAGE = new Map<string, number>();

export const COOLDOWN_MS = parseInt(
  process.env.AUTO_IMAGE_COOLDOWN_MS ?? "10000",
  10
);

export function isOnCooldown(userId: string): boolean {
  const last = USER_LAST_IMAGE.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

export function stampCooldown(userId: string): void {
  USER_LAST_IMAGE.set(userId, Date.now());
  if (USER_LAST_IMAGE.size > 10_000) {
    const cutoff = Date.now() - COOLDOWN_MS;
    for (const [k, v] of USER_LAST_IMAGE) {
      if (v < cutoff) USER_LAST_IMAGE.delete(k);
    }
  }
}

/** Undo a stamp — used when the auto pipeline early-returns after stamping. */
export function refundCooldown(userId: string): void {
  USER_LAST_IMAGE.delete(userId);
}
