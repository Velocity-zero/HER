"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Global app error boundary (root segment).
 *
 * Covers any error that escapes a child segment's own boundary.
 * Same warm fallback so users never see Next's stark default error UI.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[HER /] Root error:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center bg-her-bg px-6 text-center">
      <div className="animate-breathe mb-6 h-2 w-2 rounded-full bg-her-accent/45 shadow-[0_0_16px_3px_rgba(201,110,90,0.08)]" />
      <h1 className="mb-3 text-[18px] font-light tracking-[0.04em] text-her-text/85">
        something hiccuped
      </h1>
      <p className="mb-8 max-w-[280px] text-[12px] leading-relaxed text-her-text-muted/55">
        give it a moment and try again.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="min-h-[44px] rounded-full border border-her-accent/30 bg-her-accent/[0.06] px-6 py-2.5 text-[12px] tracking-[0.06em] text-her-accent/80 transition-all duration-300 hover:border-her-accent/45 hover:bg-her-accent/[0.1] hover:text-her-accent active:scale-[0.97]"
        >
          try again
        </button>
        <Link
          href="/"
          className="min-h-[44px] rounded-full px-4 py-2.5 text-[11px] tracking-[0.06em] text-her-text-muted/40 transition-colors duration-300 hover:text-her-text-muted/65"
        >
          back to landing
        </Link>
      </div>
    </div>
  );
}
