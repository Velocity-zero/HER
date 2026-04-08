"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { signInWithEmail } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";

/**
 * AuthModal — Minimal, elegant magic-link sign-in.
 *
 * Two states:
 *   1. Enter email → sends a secure sign-in link
 *   2. Waiting state → auto-closes when session appears
 *
 * Matches the HER warm, analog aesthetic throughout.
 */

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "email" | "waiting";

/** Map raw Supabase errors to friendly copy */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("rate") || lower.includes("limit")) {
    return "too many attempts. wait a moment.";
  }
  if (lower.includes("invalid") || lower.includes("email")) {
    return "please check your email address.";
  }
  return raw;
}

export default function AuthModal({ open, onClose }: AuthModalProps) {
  const { isAuthenticated } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);

  // Focus email input when modal opens
  useEffect(() => {
    if (!open) return;
    if (step === "email") {
      const timer = setTimeout(() => emailRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [step, open]);

  // Auto-close when user becomes authenticated while modal is open
  useEffect(() => {
    if (open && isAuthenticated) {
      onClose();
    }
  }, [open, isAuthenticated, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setStep("email");
        setEmail("");
        setError(null);
        setLoading(false);
        setResending(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── Send magic link ──
  const handleSendLink = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("please enter a valid email");
      return;
    }

    setError(null);
    setLoading(true);

    const { error: sendError } = await signInWithEmail(trimmed);

    setLoading(false);

    if (sendError) {
      setError(friendlyError(sendError));
      return;
    }

    setStep("waiting");
  }, [email]);

  // ── Resend magic link ──
  const handleResend = useCallback(async () => {
    if (resending) return;
    setResending(true);
    setError(null);

    const { error: resendError } = await signInWithEmail(
      email.trim().toLowerCase()
    );

    setResending(false);

    if (resendError) {
      setError(friendlyError(resendError));
    }
  }, [email, resending]);

  // ── Key handler ──
  const handleEmailKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !loading) handleSendLink();
    },
    [handleSendLink, loading]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-her-text/20 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={step === "email" ? "Sign in" : "Check your email"}
        className="animate-fade-in relative w-full max-w-[340px] rounded-2xl bg-her-bg px-6 py-7 shadow-lg sm:max-w-[380px] sm:px-8 sm:py-9"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-her-text-muted/30 transition-colors hover:text-her-text-muted/60"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>

        {/* Breathing dot + title */}
        <div className="mb-6 flex items-center gap-2">
          <div className="animate-breathe h-[6px] w-[6px] rounded-full bg-her-accent/80" />
          <h2 className="text-[13px] font-light tracking-[0.15em] text-her-text-muted/70">
            {step === "email" ? "sign in" : "check your email"}
          </h2>
        </div>

        {/* ── State A: Email Entry ── */}
        {step === "email" && (
          <div className="space-y-4">
            <p className="text-[12px] leading-relaxed text-her-text-muted/50">
              enter your email and we&apos;ll send you
              <br />
              a secure sign-in link. no password needed.
            </p>

            <input
              ref={emailRef}
              type="email"
              placeholder="your email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={handleEmailKey}
              disabled={loading}
              className="focus-warm w-full rounded-xl border border-her-border/50 bg-her-surface-light/60 px-4 py-3 text-[13px] text-her-text placeholder:text-her-text-muted/30 transition-colors duration-300"
              autoComplete="email"
              inputMode="email"
            />

            <button
              onClick={handleSendLink}
              disabled={loading || !email.trim()}
              className="w-full rounded-xl bg-her-accent/90 px-4 py-3 text-[12px] font-medium tracking-[0.08em] text-white transition-all duration-300 hover:bg-her-accent disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {loading ? "sending…" : "send sign-in link"}
            </button>
          </div>
        )}

        {/* ── State B: Waiting for magic link ── */}
        {step === "waiting" && (
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-[12px] leading-relaxed text-her-text-muted/55">
                we sent a sign-in link to{" "}
                <span className="text-her-text-muted/75">{email.trim()}</span>.
              </p>
              <p className="text-[12px] leading-relaxed text-her-text-muted/55">
                open it to continue.
              </p>
            </div>

            {/* Gentle waiting indicator */}
            <div className="flex items-center justify-center gap-1.5 py-2">
              <div className="animate-soft-pulse h-[5px] w-[5px] rounded-full bg-her-accent/40" />
              <div className="animate-soft-pulse h-[5px] w-[5px] rounded-full bg-her-accent/40" style={{ animationDelay: "0.3s" }} />
              <div className="animate-soft-pulse h-[5px] w-[5px] rounded-full bg-her-accent/40" style={{ animationDelay: "0.6s" }} />
            </div>

            <p className="text-center text-[10px] leading-relaxed text-her-text-muted/30">
              for the smoothest experience, open the
              <br />
              link on this same device.
            </p>

            {/* Actions row */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
                className="py-1 text-[11px] tracking-[0.08em] text-her-text-muted/35 transition-colors hover:text-her-text-muted/55"
              >
                different email
              </button>

              <button
                onClick={handleResend}
                disabled={resending}
                className="py-1 text-[11px] tracking-[0.08em] text-her-text-muted/35 transition-colors hover:text-her-text-muted/55 disabled:opacity-40"
              >
                {resending ? "sending…" : "resend link"}
              </button>
            </div>

            <p className="text-center text-[10px] text-her-text-muted/25">
              still waiting? check spam or promotions.
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <p className="mt-3 text-center text-[11px] text-her-accent/80 animate-fade-in">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
