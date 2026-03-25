"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  getCurrentSession,
  onAuthStateChange,
  signOut as authSignOut,
} from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase-client";

// ── Context Shape ──────────────────────────────────────────

interface AuthContextValue {
  /** Current Supabase session (null = guest / signed out) */
  session: Session | null;
  /** Convenience shortcut for session.user */
  user: User | null;
  /** True while we're resolving the initial session */
  loading: boolean;
  /** True when the user is authenticated (not a guest) */
  isAuthenticated: boolean;
  /** Sign out and revert to guest mode */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  isAuthenticated: false,
  signOut: async () => {},
});

// ── Hook ───────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// ── Provider ───────────────────────────────────────────────

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the initial session once on mount
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // No Supabase → instant guest mode, no loading
      setLoading(false);
      return;
    }

    let mounted = true;

    getCurrentSession().then((s) => {
      if (mounted) {
        setSession(s);
        setLoading(false);
      }
    });

    // Subscribe to auth changes (sign in, sign out, token refresh)
    const unsubscribe = onAuthStateChange((_event, newSession) => {
      if (mounted) {
        setSession(newSession);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    await authSignOut();
    setSession(null);
  }, []);

  const user = session?.user ?? null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        isAuthenticated: !!user,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
