"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { ConversationMode } from "@/lib/types";

/**
 * ModeSelector — Subtle, swipeable pill bar for switching conversation vibes.
 * Lives below the header. Feels like tabs in a music app, not a settings panel.
 * Horizontally scrollable on mobile, centered on desktop.
 */

interface ModeSelectorProps {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
  disabled?: boolean;
}

const MODES: { value: ConversationMode; label: string; emoji: string }[] = [
  { value: "default", label: "chill", emoji: "" },
  { value: "comfort", label: "comfort", emoji: "" },
  { value: "playful", label: "playful", emoji: "" },
  { value: "deep", label: "deep", emoji: "" },
  { value: "curious", label: "explore", emoji: "" },
];

export default function ModeSelector({ mode, onChange, disabled }: ModeSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide after 4s of no interaction (only if not default)
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 4000);
  }, []);

  // Show on any interaction, restart timer
  const handleInteraction = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // Always visible initially, auto-hide after first timeout
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  // Scroll active mode into view
  useEffect(() => {
    if (!scrollRef.current) return;
    const active = scrollRef.current.querySelector("[data-active='true']") as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [mode]);

  return (
    <div
      className={`transition-all duration-500 ease-out overflow-hidden ${
        visible ? "max-h-12 opacity-100" : "max-h-0 opacity-0"
      }`}
      onPointerEnter={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <div
        ref={scrollRef}
        className="flex items-center justify-center gap-1 px-3 pb-2 pt-0.5 sm:gap-1.5 sm:px-5 overflow-x-auto"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
      >
        {MODES.map((m) => {
          const isActive = mode === m.value;
          return (
            <button
              key={m.value}
              data-active={isActive}
              onClick={() => {
                onChange(m.value);
                handleInteraction();
              }}
              disabled={disabled}
              className={`
                relative whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] tracking-[0.08em]
                transition-all duration-300 ease-out
                disabled:opacity-30 disabled:cursor-not-allowed
                sm:px-3.5 sm:py-1.5 sm:text-[11px]
                ${isActive
                  ? "bg-her-accent/[0.09] text-her-accent/70 shadow-[0_0_0_0.5px_rgba(201,110,90,0.1)]"
                  : "text-her-text-muted/30 hover:text-her-text-muted/50 hover:bg-her-surface/40"
                }
              `}
            >
              {m.label}
              {isActive && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] w-[3px] rounded-full bg-her-accent/50" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
