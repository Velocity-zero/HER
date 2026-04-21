"use client";

import { useEffect, useRef, useCallback, useLayoutEffect } from "react";

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
  /**
   * Called when the user scrolls near the top of the conversation.
   * Use this to load older messages. The window automatically preserves
   * the user's scroll position after the new content is prepended, so
   * they stay anchored on the same message they were reading.
   */
  onScrollNearTop?: () => void;
  /**
   * A counter the parent increments JUST BEFORE prepending older messages.
   * The window snapshots scrollHeight so it can restore scrollTop after the
   * prepend completes — keeps the user anchored on what they were reading.
   */
  prependAnchor?: number;
}

export default function ChatWindow({
  children,
  autoScroll = true,
  scrollTrigger,
  forceScrollTrigger,
  onScrollNearTop,
  prependAnchor,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Snapshot taken when prependAnchor changes; consumed after the next render. */
  const preprendSnapshot = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  /** Throttle: don't fire onScrollNearTop more than once per 800ms */
  const lastTopFireRef = useRef<number>(0);

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

  /** Detect scroll-to-top → snapshot, then trigger onScrollNearTop (throttled) */
  const handleScroll = useCallback(() => {
    if (!onScrollNearTop || !containerRef.current) return;
    const el = containerRef.current;
    // Trigger when user is within 80px of the top
    if (el.scrollTop < 80) {
      const now = Date.now();
      if (now - lastTopFireRef.current < 800) return;
      lastTopFireRef.current = now;
      // Snapshot BEFORE the parent prepends — so we can restore anchor after.
      preprendSnapshot.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
      onScrollNearTop();
    }
  }, [onScrollNearTop]);

  // After children render, if we have a pending snapshot AND scrollHeight grew,
  // restore scrollTop so the user stays anchored on the same message.
  // `prependAnchor` is the parent's signal that new content was just prepended.
  useLayoutEffect(() => {
    const snap = preprendSnapshot.current;
    if (!snap || !containerRef.current) return;
    const el = containerRef.current;
    const delta = el.scrollHeight - snap.scrollHeight;
    if (delta > 0) {
      el.scrollTop = snap.scrollTop + delta;
      preprendSnapshot.current = null;
    }
    // If delta <= 0, the prepend hasn't landed yet — keep waiting.
  }, [prependAnchor]);

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
      onScroll={handleScroll}
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
