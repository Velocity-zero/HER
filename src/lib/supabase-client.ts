import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Server-only: bypasses RLS. NEVER expose to the browser.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cachedBrowserClient: SupabaseClient | null = null;
let cachedServerClient: SupabaseClient | null = null;

/**
 * Returns true only when public Supabase env vars are present.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/**
 * Returns true if the server-side service-role key is configured.
 * Used by cron + privileged server routes that need to bypass RLS.
 */
export function hasServiceRoleKey(): boolean {
  return Boolean(supabaseUrl && supabaseServiceKey);
}

/**
 * Safe client getter for browser/server usage in this app.
 *
 * - On the **server** (Node/Next.js API routes): prefers the service-role key
 *   if `SUPABASE_SERVICE_ROLE_KEY` is set (bypasses RLS — required for cron
 *   and privileged background jobs). Falls back to anon key otherwise.
 * - On the **browser**: always uses the anon key with session persistence.
 * - Returns null when env vars are missing (non-breaking foundation behavior)
 * - Uses separate cached singletons for browser vs server contexts.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Client not initialized yet."
      );
    }
    return null;
  }

  const isServer = typeof window === "undefined";

  if (isServer) {
    if (cachedServerClient) return cachedServerClient;

    // Prefer service-role key on server when available — required so cron jobs
    // and privileged routes can read/write across users without RLS friction.
    const key = supabaseServiceKey || supabaseAnonKey!;

    if (!supabaseServiceKey && process.env.NODE_ENV !== "production") {
      console.warn(
        "[Supabase] SUPABASE_SERVICE_ROLE_KEY not set — server is using anon key. " +
          "Cron jobs and cross-user reads may be blocked by RLS."
      );
    }

    cachedServerClient = createClient(supabaseUrl!, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return cachedServerClient;
  }

  // Browser path
  if (cachedBrowserClient) return cachedBrowserClient;
  cachedBrowserClient = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedBrowserClient;
}
