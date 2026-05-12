/**
 * HER — Synthetic Self-State Persistence (Step 18.X)
 *
 * Thin Supabase adapter for the `her_self_state` table. The store is
 * deliberately tolerant: missing client, missing table, missing row, or
 * any DB error all degrade to "neutral state, no last-updated" so that
 * the chat path is never blocked by a self-model failure.
 *
 * Schema (see supabase-step-18.sql):
 *   her_self_state (
 *     user_id     UUID PRIMARY KEY,
 *     state       JSONB NOT NULL,
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   )
 */

import { getSupabaseClient } from "./supabase-client";
import {
  NEUTRAL_STATE,
  validateSelfState,
  type SyntheticSelfState,
} from "./self-model";
import { debug } from "./debug";

const TABLE = "her_self_state";

export interface LoadedSelfState {
  state: SyntheticSelfState;
  /** When the state was last persisted, or null on a cold start. */
  lastUpdated: Date | null;
}

/**
 * Load the latest stored state for a user.
 * Always returns something usable — never throws.
 */
export async function loadSelfState(userId: string): Promise<LoadedSelfState> {
  if (!userId) return { state: { ...NEUTRAL_STATE }, lastUpdated: null };

  const sb = getSupabaseClient();
  if (!sb) return { state: { ...NEUTRAL_STATE }, lastUpdated: null };

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("state, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      // Likely the table doesn't exist yet — log once and degrade quietly.
      debug("[HER Self] load error (degrading to neutral):", error.message);
      return { state: { ...NEUTRAL_STATE }, lastUpdated: null };
    }
    if (!data) {
      return { state: { ...NEUTRAL_STATE }, lastUpdated: null };
    }
    return {
      state: validateSelfState(data.state),
      lastUpdated: data.updated_at ? new Date(data.updated_at) : null,
    };
  } catch (err) {
    debug("[HER Self] load threw (degrading to neutral):", err);
    return { state: { ...NEUTRAL_STATE }, lastUpdated: null };
  }
}

/**
 * Upsert the latest state. Silent on failure — chat must never block.
 */
export async function saveSelfState(
  userId: string,
  state: SyntheticSelfState,
): Promise<boolean> {
  if (!userId) return false;
  const sb = getSupabaseClient();
  if (!sb) return false;

  try {
    const { error } = await sb
      .from(TABLE)
      .upsert(
        { user_id: userId, state, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) {
      debug("[HER Self] save error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    debug("[HER Self] save threw:", err);
    return false;
  }
}
