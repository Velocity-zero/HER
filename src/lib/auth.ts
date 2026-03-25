/**
 * HER — Supabase Auth Helpers
 *
 * Magic-link email authentication. User enters email → receives
 * a secure sign-in link → clicks it → session resolves automatically.
 *
 * Guest mode is preserved — all functions gracefully return null
 * when Supabase is not configured.
 */

import { Session, User, AuthChangeEvent } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";

// ── Types ──────────────────────────────────────────────────

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

// ── Send Magic Link ────────────────────────────────────────

/**
 * Send a secure sign-in link to the given email address.
 * Returns { error } — null error means the link was sent.
 */
export async function signInWithEmail(
  email: string
): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { error: "Supabase is not configured." };

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });

  if (error) return { error: error.message };
  return { error: null };
}

// ── Verify OTP Code ────────────────────────────────────────

/**
 * Verify a 6-digit OTP code the user received via email.
 * Returns session + user on success, or an error message.
 */
export async function verifyOtp(
  email: string,
  token: string
): Promise<{ session: Session | null; user: User | null; error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { session: null, user: null, error: "Supabase is not configured." };

  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) return { session: null, user: null, error: error.message };
  return { session: data.session, user: data.user, error: null };
}

// ── Get Current Session ────────────────────────────────────

/**
 * Returns the current session if one exists, null otherwise.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  return data.session;
}

/**
 * Returns the current user if signed in, null otherwise.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

// ── Auth State Listener ────────────────────────────────────

/**
 * Subscribe to auth state changes (sign in, sign out, token refresh).
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): (() => void) | null {
  if (!isSupabaseConfigured()) return null;

  const client = getSupabaseClient();
  if (!client) return null;

  const { data } = client.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

// ── Sign Out ───────────────────────────────────────────────

/**
 * Sign the user out. Clears the session.
 * Returns { error } — null error means success.
 */
export async function signOut(): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { error: null }; // Nothing to sign out of

  const { error } = await client.auth.signOut();
  if (error) return { error: error.message };
  return { error: null };
}
