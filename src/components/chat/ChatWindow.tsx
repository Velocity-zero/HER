"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * ChatWindow — Scrollable conversation container.
 * Messages float near the bottom, creating an atmospheric
 * calm space above. Like a conversation happening in
 * a warm, quiet room with high ceilings.
 */

interface ChatWindowProps {
  children?: React.ReactNode;
  autoScroll?: boolean;
  /** Changing this value triggers a scroll-to-bottom check (e.g. increment during streaming) */
  scrollTrigger?: number;
  /** When > 0, forces an unconditional scroll (ignores near-bottom check). Increment to trigger. */
  forceScrollTrigger?: number;
}

export default function ChatWindow({ children, autoScroll = true, scrollTrigger, forceScrollTrigger }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /** Scroll to bottom — optionally force (skip near-bottom check) */
  const scrollToBottom = useCallback((force = false) => {
    if (!autoScroll || !containerRef.current || !bottomRef.current) return;

    const el = containerRef.current;

    if (!force) {
      // Only auto-scroll if user is near the bottom (within 200px)
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (!isNearBottom) return;
    }

    // Use instant during rapid updates (streaming), smooth for single events
    bottomRef.current.scrollIntoView({ behavior: "instant", block: "end" });
  }, [autoScroll]);

  /**
   * Clear text selection when tapping on whitespace / non-text areas.
   * On mobile, `user-select: none` on the body prevents new selections
   * but doesn't clear an existing one when you tap away.
   * This handler bridges that gap — tapping anywhere outside selectable
   * text or interactive elements clears the selection naturally.
   */
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return; // no active selection — nothing to do

    const target = e.target as HTMLElement;
    // Don't clear if the user tapped on selectable text or an interactive element
    if (
      target.closest(".msg-text-selectable") ||
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input") ||
      target.closest("textarea")
    ) return;

    sel.removeAllRanges();
  }, []);

  // Scroll when scrollTrigger changes (streaming chunks) — conditional
  useEffect(() => {
    scrollToBottom(false);
  }, [scrollTrigger, scrollToBottom]);

  // Force scroll when forceScrollTrigger changes (new message sent/received)
  useEffect(() => {
    if (!forceScrollTrigger) return;
    // Use rAF to let the DOM update first, then scroll
    requestAnimationFrame(() => {
      scrollToBottom(true);
    });
  }, [forceScrollTrigger, scrollToBottom]);

  return (
    <div
      ref={containerRef}
      className="chat-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
      onClick={handleContainerClick}
    >
      {/* Push messages toward the bottom — atmospheric empty space above */}
      <div className="flex-1" />

      {/* Centered conversation column */}
      <div className="mx-auto w-full max-w-[640px] px-3 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-6 md:px-6">
        {children}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
