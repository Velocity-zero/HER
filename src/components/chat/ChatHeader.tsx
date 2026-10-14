"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

/**
 * ChatHeader â€” Refined, cinematic header.
 * Stripped to three elements: history (left) Â· HER wordmark (center) Â· new chat (right).
 * The breathing dot still anchors the room. Identity, notifications,
 * and "back to landing" all live inside the HistoryDrawer now â€”
 * keeping the conversation chrome quiet and symmetric.
 */

interface ChatHeaderProps {
  onClear?: () => void;
  onHistoryOpen?: () => void;
  /** Opens the magic-link sign-in modal. Shown for guests in place of the history icon. */
  onSignInClick?: () => void;
  /** Opens the hands-free Earbud voice mode. */
  onEarbudOpen?: () => void;
  /** Whether earbud voice mode is currently active. */
  isEarbudActive?: boolean;
  /** Kept for API compatibility; no longer used by the header itself. */
  accessToken?: string | null;
}

export default function ChatHeader({ onClear, onHistoryOpen, onSignInClick, onEarbudOpen, isEarbudActive }: ChatHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const { isAuthenticated, loading } = useAuth();

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

  return (
    <header className="relative flex shrink-0 items-center justify-between px-4 py-3.5 sm:px-5 sm:py-4 md:px-6 md:py-5">
      {/* Left â€” history (icon only, the gateway to identity & settings) */}
      <div className="flex items-center">
        {!loading && isAuthenticated && onHistoryOpen ? (
          <button
            onClick={onHistoryOpen}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-her-text-muted/40 transition-colors duration-300 hover:text-her-text-muted/65 active:text-her-text-muted/55 focus-visible:outline-none focus-visible:text-her-text-muted/65"
            title="Conversations & settings"
            aria-label="Open conversations and settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        ) : !loading && !isAuthenticated && onSignInClick ? (
          <button
            onClick={onSignInClick}
            className="min-h-[44px] rounded-full px-3 py-1 text-[10px] tracking-[0.1em] text-her-text-muted/40 transition-colors duration-300 hover:text-her-text-muted/65 active:text-her-text-muted/55 focus-visible:outline-none focus-visible:text-her-text-muted/65"
            aria-label="Sign in"
          >
            sign in
          </button>
        ) : (
          // Reserve space so the center brand stays optically centered for guests too
          <div className="min-h-[44px] min-w-[44px]" />
        )}
      </div>

      {/* Center branding â€” alive, breathing */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="animate-breathe h-[6px] w-[6px] rounded-full bg-her-accent/70 shadow-[0_0_10px_2px_rgba(201,110,90,0.06)] sm:h-[7px] sm:w-[7px]" />
        <span className="text-[12px] font-light tracking-[0.22em] text-her-text-muted/55 sm:text-[13px] sm:tracking-[0.25em]">
          HER
        </span>
      </div>

      {/* Right — Earbud Mode & primary action */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        {onEarbudOpen && (
          <button
            onClick={onEarbudOpen}
            aria-label="Call Samantha"
            title="Call Samantha (Phone Call Mode)"
            className={`
              flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full
              transition-all duration-300 ease-out active:scale-[0.92]
              ${isEarbudActive
                ? "text-her-accent"
                : "text-her-text-muted/40 hover:text-her-text-muted/65"
              }
            `}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-[17px] w-[17px]"
            >
              <path fillRule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" clipRule="evenodd" />
            </svg>
          </button>
        )}

        {onClear ? (
          <button
            onClick={handleClearClick}
            aria-label={confirming ? "Confirm clear conversation" : isAuthenticated ? "Start a new chat" : "Start over"}
            className={`
              min-h-[44px] rounded-full px-3 py-1 text-[10px] tracking-[0.1em]
              transition-all duration-300 ease-out active:scale-[0.96]
              ${confirming
                ? "bg-her-accent/10 text-her-accent"
                : "text-her-text-muted/40 hover:text-her-text-muted/65"
              }
            `}
          >
            {confirming ? "sure?" : isAuthenticated ? "new chat" : "start over"}
          </button>
        ) : (
          <div className="min-h-[44px] min-w-[44px]" />
        )}
      </div>
    </header>
  );
}
