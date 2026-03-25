"use client";

import { useState, useEffect } from "react";

/**
 * EmptyState — Warm, cinematic presence when the conversation is fresh.
 *
 * Feels like HER is already here, quietly waiting.
 * Suggestion chips let the user ease into conversation naturally.
 */

const SUGGESTIONS = [
  "tell me about your day",
  "help me think clearly",
  "i need advice",
  "stay with me for a while",
];

interface EmptyStateProps {
  /** Prefill the composer with a suggestion */
  onSuggestion: (text: string) => void;
}

export default function EmptyState({ onSuggestion }: EmptyStateProps) {
  const [visible, setVisible] = useState(false);

  // Stagger appearance for a calm entrance
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex flex-col items-center justify-center py-12 transition-opacity duration-700 ease-out sm:py-20 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Breathing presence orb */}
      <div className="animate-breathe mb-8 h-[10px] w-[10px] rounded-full bg-her-accent/50 shadow-[0_0_20px_4px_rgba(201,110,90,0.12)]" />

      {/* Greeting */}
      <p className="mb-2 text-[14px] font-light tracking-[0.08em] text-her-text/60 sm:text-[15px]">
        i&apos;m here.
      </p>

      {/* Subtext */}
      <p className="mb-10 text-[12px] font-light tracking-[0.04em] text-her-text-muted/35 sm:mb-12 sm:text-[13px]">
        what&apos;s on your mind?
      </p>

      {/* Suggestion chips */}
      <div className="flex flex-wrap justify-center gap-2 px-4 sm:gap-2.5">
        {SUGGESTIONS.map((text, i) => (
          <button
            key={text}
            onClick={() => onSuggestion(text)}
            className="rounded-full border border-her-border/30 bg-her-surface/30 px-3.5 py-2 text-[11px] tracking-[0.04em] text-her-text-muted/45 transition-all duration-300 hover:border-her-accent/20 hover:bg-her-accent/[0.04] hover:text-her-text-muted/65 active:scale-[0.97] sm:px-4 sm:py-2.5 sm:text-[12px]"
            style={{
              animationDelay: `${150 + i * 80}ms`,
              animationFillMode: "backwards",
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
