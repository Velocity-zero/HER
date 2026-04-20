"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import NotificationSettings from "@/components/chat/NotificationSettings";

/**
 * ChatHeader — Refined, cinematic header.
 * The breathing dot feels alive. The typography is airy.
 * A gentle "start over" lives quietly on the right.
 * Auth button sits subtly beside "start over".
 */

interface ChatHeaderProps {
  onClear?: () => void;
  onHistoryOpen?: () => void;
  accessToken?: string | null;
}

export default function ChatHeader({ onClear, onHistoryOpen, accessToken }: ChatHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuth();

  // Auto-dismiss the confirm state after 3 seconds
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const handleClearClick = useCallback(() => {
    if (confirming) {
      onClear?.();
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  }, [confirming, onClear]);

  // Derive a short display label for the authenticated user
  const userLabel = user?.email
    ? user.email.split("@")[0].slice(0, 12)
    : null;

  return (
    <>
      <header className="relative flex shrink-0 items-center justify-between px-4 py-3.5 sm:px-5 sm:py-4 md:px-6 md:py-5">
        {/* Left side: back + history */}
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 text-[11px] tracking-[0.1em] text-her-text-muted/45 transition-colors duration-300 hover:text-her-text-muted/70 active:text-her-text-muted/55 focus-visible:outline-none focus-visible:text-her-text-muted/70"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3 w-3"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
            back
          </Link>

          {/* History button — subtle, only shows when signed in */}
          {!loading && isAuthenticated && onHistoryOpen && (
            <button
              onClick={onHistoryOpen}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-her-text-muted/35 transition-colors duration-300 hover:text-her-text-muted/60"
              title="Chat history"
              aria-label="Open chat history"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}

          {/* Notification settings — bell icon, on left to avoid crowding HER wordmark */}
          {!loading && isAuthenticated && (
            <button
              onClick={() => setNotifyOpen(true)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-her-text-muted/30 transition-colors duration-300 hover:text-her-text-muted/55"
              title="Notification settings"
              aria-label="Notification settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M10 2a6 6 0 00-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 00.515 1.076 32.91 32.91 0 003.256.508 3.5 3.5 0 006.972 0 32.903 32.903 0 003.256-.508.75.75 0 00.515-1.076A11.448 11.448 0 0116 8a6 6 0 00-6-6zM8.05 14.943a33.54 33.54 0 003.9 0 2 2 0 01-3.9 0z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>

        {/* Center branding — alive, breathing */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <div className="animate-breathe h-[6px] w-[6px] rounded-full bg-her-accent/70 shadow-[0_0_10px_2px_rgba(201,110,90,0.06)] sm:h-[7px] sm:w-[7px]" />
          <span className="text-[12px] font-light tracking-[0.22em] text-her-text-muted/55 sm:text-[13px] sm:tracking-[0.25em]">
            HER
          </span>
        </div>

        {/* Right side: auth + clear */}
        <div className="flex items-center gap-1">
          {/* Auth button — subtle, never obtrusive */}
          {!loading && (
            isAuthenticated ? (
              <button
                onClick={signOut}
                className="min-h-[44px] rounded-full px-2.5 py-1 text-[10px] tracking-[0.08em] text-her-accent/50 transition-colors duration-300 hover:text-her-accent/80"
                title={user?.email || "Signed in"}
                aria-label={`Sign out ${userLabel || ""}`}
              >
                {userLabel}
              </button>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                className="min-h-[44px] rounded-full px-2.5 py-1 text-[10px] tracking-[0.08em] text-her-text-muted/30 transition-colors duration-300 hover:text-her-text-muted/55"
                aria-label="Sign in"
              >
                sign in
              </button>
            )
          )}

          {/* Clear / new chat */}
          {onClear ? (
            <button
              onClick={handleClearClick}
              aria-label={confirming ? "Confirm clear conversation" : isAuthenticated ? "Start a new chat" : "Start over"}
              className={`
                min-h-[44px] rounded-full px-3 py-1 text-[10px] tracking-[0.1em]
                transition-all duration-300 ease-out active:scale-[0.96]
                ${confirming
                  ? "bg-her-accent/10 text-her-accent"
                  : "text-her-text-muted/30 hover:text-her-text-muted/55"
                }
              `}
            >
              {confirming ? "sure?" : isAuthenticated ? "new chat" : "start over"}
            </button>
          ) : (
            <div className="w-16" />
          )}
        </div>
      </header>

      {/* Auth modal */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      {/* Notification settings panel */}
      <NotificationSettings
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        accessToken={accessToken ?? null}
      />
    </>
  );
}
