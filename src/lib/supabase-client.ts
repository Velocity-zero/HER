import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cachedClient: SupabaseClient | null = null;

/**
 * Returns true only when public Supabase env vars are present.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/**
 * Safe client getter for browser/server usage in this app.
 * - Returns null when env vars are missing (non-breaking foundation behavior)
 * - Uses a cached singleton once configured
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

  if (cachedClient) return cachedClient;

  cachedClient = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return cachedClient;
}
