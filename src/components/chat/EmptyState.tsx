"use client";

import { useState, useEffect } from "react";

/**
 * EmptyState — Warm, cinematic presence when the conversation is fresh.
 *
 * Feels like HER is already here, quietly waiting.
 * Suggestion chips let the user ease into conversation naturally.
 * All copy is now driven by SurfaceCopyBundle — dynamic per session.
 */

const FALLBACK_SUGGESTIONS = [
  "what's good?",
  "i'm bored entertain me",
  "make me laugh",
  "help me figure something out",
];

const FALLBACK_OPENING_LINE = "hey.";
const FALLBACK_SUBTEXT = "say whatever";

interface EmptyStateProps {
  /** Prefill the composer with a suggestion */
  onSuggestion: (text: string) => void;
  /** Dynamic suggestion chips from surface copy bundle */
  suggestions?: string[];
  /** Dynamic opening line from surface copy bundle */
  openingLine?: string;
  /** Dynamic subtext from surface copy bundle */
  openingSubtext?: string;
}

export default function EmptyState({ onSuggestion, suggestions, openingLine, openingSubtext }: EmptyStateProps) {
  const [visible, setVisible] = useState(false);

  const chips = suggestions && suggestions.length > 0 ? suggestions : FALLBACK_SUGGESTIONS;
  const headline = openingLine || FALLBACK_OPENING_LINE;
  const subtext = openingSubtext || FALLBACK_SUBTEXT;

  // Stagger appearance for a calm entrance
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex flex-col items-center justify-center py-14 transition-opacity duration-1000 ease-out sm:py-20 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Breathing presence orb */}
      <div className="animate-breathe mb-8 h-[9px] w-[9px] rounded-full bg-her-accent/35 shadow-[0_0_20px_4px_rgba(201,110,90,0.08)] sm:mb-10" />

      {/* Opening line */}
      <p className="mb-1.5 font-light tracking-[0.14em] text-her-text/45 text-[15px] sm:text-[16px]">
        {headline}
      </p>

      {/* Subtext */}
      <p className="mb-10 font-light tracking-[0.04em] text-her-text-muted/28 text-[11px] sm:mb-12 sm:text-[12px]">
        {subtext}
      </p>

      {/* Suggestion chips */}
      <div className="flex flex-wrap justify-center gap-2 px-8 sm:gap-2.5 sm:px-6">
        {chips.map((text, i) => (
          <button
            key={text}
            onClick={() => onSuggestion(text)}
            className="rounded-full border border-her-border/20 bg-her-surface/30 px-4 py-2.5 text-[11px] tracking-[0.04em] text-her-text-muted/40 transition-all duration-300 hover:border-her-accent/20 hover:bg-her-accent/[0.04] hover:text-her-text-muted/60 active:scale-[0.96] sm:px-5 sm:py-2.5 sm:text-[12px]"
            style={{
              animationDelay: `${250 + i * 100}ms`,
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
