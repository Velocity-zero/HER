"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import type { ConversationSummary } from "@/lib/supabase-persistence";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import NotificationSettings from "@/components/chat/NotificationSettings";

/**
 * HistoryDrawer — A soft, slide-in panel for authenticated chat history.
 *
 * Features:
 *   - Identity strip (user chip + sign out, or sign-in pill for guests)
 *   - Notifications row (opens push settings)
 *   - New chat button
 *   - Conversation list with date grouping (Today / Yesterday / Older)
 *   - Inline rename via "…" menu
 *   - Delete with inline confirmation
 *   - Footer "back to landing" link
 */

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, title: string) => Promise<boolean>;
  onDeleteConversation: (id: string) => Promise<boolean>;
  isAuthenticated: boolean;
  loading: boolean;
  /** Conversation IDs with unread messages (e.g. notifications arrived while away). */
  unreadIds?: Set<string>;
  /** Required to enable notification settings (push subscribe API). */
  accessToken?: string | null;
}

// ── Date helpers ───────────────────────────────────────────

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

type DateGroup = { label: string; conversations: ConversationSummary[] };

function groupByDate(convos: ConversationSummary[]): DateGroup[] {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86400000;

  const today: ConversationSummary[] = [];
  const yesterday: ConversationSummary[] = [];
  const older: ConversationSummary[] = [];

  for (const c of convos) {
    const ts = c.last_message_at || c.created_at;
    const time = new Date(ts).getTime();
    if (time >= todayStart) today.push(c);
    else if (time >= yesterdayStart) yesterday.push(c);
    else older.push(c);
  }

  const groups: DateGroup[] = [];
  if (today.length > 0) groups.push({ label: "today", conversations: today });
  if (yesterday.length > 0) groups.push({ label: "yesterday", conversations: yesterday });
  if (older.length > 0) groups.push({ label: "older", conversations: older });
  return groups;
}

// ── Main Component ─────────────────────────────────────────

export default function HistoryDrawer({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  isAuthenticated,
  loading,
  unreadIds,
  accessToken,
}: HistoryDrawerProps) {
  // ── Local interaction state ──
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Modals owned by the drawer (relocated from ChatHeader)
  const [authOpen, setAuthOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const { user, signOut } = useAuth();
  const userLabel = user?.email ? user.email.split("@")[0].slice(0, 18) : null;


  const renameRef = useRef<HTMLInputElement>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameRef.current?.focus(), 50);
    }
  }, [renamingId]);

  // Focus trap + Escape key handler + restore focus on close
  useEffect(() => {
    if (open) {
      // Store the previously focused element to restore later
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // Focus the drawer after transition
      setTimeout(() => drawerRef.current?.focus(), 100);
    } else {
      // Restore focus when drawer closes
      setTimeout(() => previousFocusRef.current?.focus(), 310);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap — Tab cycles within the drawer
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Reset interaction state when drawer closes
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setMenuOpenId(null);
        setRenamingId(null);
        setDeletingId(null);
        setBusyId(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── Handlers ──

  const handleSelect = useCallback(
    (id: string) => {
      if (loading || busyId) return;
      onSelectConversation(id);
      onClose();
    },
    [onSelectConversation, onClose, loading, busyId]
  );

  const handleNewChat = useCallback(() => {
    onNewChat();
    onClose();
  }, [onNewChat, onClose]);

  const startRename = useCallback(
    (convo: ConversationSummary) => {
      setMenuOpenId(null);
      setDeletingId(null);
      setRenamingId(convo.id);
      setRenameValue(convo.title || "");
    },
    []
  );

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    const finalTitle = trimmed || "new conversation";

    setBusyId(renamingId);
    const success = await onRenameConversation(renamingId, finalTitle);
    setBusyId(null);

    if (success) {
      setRenamingId(null);
      setRenameValue("");
    }
  }, [renamingId, renameValue, onRenameConversation]);

  const startDelete = useCallback((id: string) => {
    setMenuOpenId(null);
    setRenamingId(null);
    setDeletingId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeletingId(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingId) return;
    setBusyId(deletingId);
    const success = await onDeleteConversation(deletingId);
    setBusyId(null);

    if (success) {
      setDeletingId(null);
    }
  }, [deletingId, onDeleteConversation]);

  const toggleMenu = useCallback((id: string) => {
    setMenuOpenId((prev) => (prev === id ? null : id));
    setRenamingId(null);
    setDeletingId(null);
  }, []);

  // ── Grouped conversations ──
  const groups = groupByDate(conversations);

  // ── Render a single conversation row ──
  const renderConvoItem = (convo: ConversationSummary) => {
    const isActive = convo.id === activeConversationId;
    const isRenaming = renamingId === convo.id;
    const isDeleting = deletingId === convo.id;
    const isMenuOpen = menuOpenId === convo.id;
    const isBusy = busyId === convo.id;
    const isUnread = !!unreadIds?.has(convo.id);

    // ── Delete confirmation state ──
    if (isDeleting) {
      return (
        <div
          key={convo.id}
          className="animate-fade-in rounded-xl border border-her-accent/15 bg-her-accent/[0.04] px-3.5 py-3"
        >
          <p className="text-[11px] leading-snug text-her-text-muted/60">
            delete this conversation?
          </p>
          <p className="mt-0.5 text-[10px] text-her-text-muted/30">
            this can&apos;t be undone.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={confirmDelete}
              disabled={isBusy}
              className="rounded-lg bg-her-accent/80 px-3 py-1.5 text-[10px] font-medium tracking-[0.06em] text-white transition-all duration-200 hover:bg-her-accent disabled:opacity-50 active:scale-[0.97]"
            >
              {isBusy ? "deleting…" : "delete"}
            </button>
            <button
              onClick={cancelDelete}
              disabled={isBusy}
              className="rounded-lg px-3 py-1.5 text-[10px] tracking-[0.06em] text-her-text-muted/40 transition-colors hover:text-her-text-muted/60"
            >
              cancel
            </button>
          </div>
        </div>
      );
    }

    // ── Rename state ──
    if (isRenaming) {
      return (
        <div
          key={convo.id}
          className="rounded-xl bg-her-surface/40 px-3.5 py-2.5"
        >
          <input
            ref={renameRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            onBlur={commitRename}
            disabled={isBusy}
            className="w-full rounded-lg border border-her-border/40 bg-her-bg px-2.5 py-1.5 text-[12px] text-her-text/80 outline-none transition-colors focus:border-her-accent/30"
            maxLength={80}
            placeholder="conversation name"
          />
        </div>
      );
    }

    // ── Normal row ──
    return (
      <div
        key={convo.id}
        className={`group relative flex items-start rounded-xl transition-all duration-200 ${
          isActive
            ? "bg-her-accent/[0.07] text-her-text/80 shadow-[inset_2px_0_0_rgba(201,110,90,0.25)]"
            : "text-her-text-muted/55 hover:bg-her-surface/60 hover:text-her-text-muted/75"
        }`}
      >
        <button
          onClick={() => handleSelect(convo.id)}
          className="min-w-0 flex-1 px-3.5 py-3 text-left"
          aria-label={`Open conversation: ${convo.title || "untitled"}${isUnread ? " (new messages)" : ""}`}
        >
          <div className="flex items-center gap-2">
            {isUnread && (
              <span
                aria-hidden="true"
                className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-her-accent shadow-[0_0_6px_rgba(201,110,90,0.4)]"
              />
            )}
            <p className={`truncate text-[12px] leading-snug tracking-[0.02em] ${isUnread ? "text-her-text/85 font-medium" : ""}`}>
              {convo.title || "untitled"}
            </p>
          </div>
          <p className="mt-0.5 text-[10px] tracking-[0.04em] opacity-50">
            {relativeTime(convo.last_message_at)}
          </p>
        </button>

        {/* Overflow menu trigger */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu(convo.id);
          }}
          className={`mr-1.5 mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
            isMenuOpen
              ? "text-her-text-muted/60 bg-her-surface/80"
              : "text-her-text-muted/0 group-hover:text-her-text-muted/30 hover:!text-her-text-muted/55"
          }`}
          aria-label="Conversation actions"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm5.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {isMenuOpen && (
          <div className="animate-fade-in absolute right-1.5 top-10 z-10 min-w-[120px] rounded-xl border border-her-border/30 bg-her-bg py-1 shadow-md">
            <button
              onClick={() => startRename(convo)}
              className="flex w-full items-center gap-2 px-3.5 py-2 text-[11px] tracking-[0.04em] text-her-text-muted/60 transition-colors hover:bg-her-surface/50 hover:text-her-text-muted/80"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path d="M13.488 2.513a1.75 1.75 0 00-2.475 0L3.05 10.476a.75.75 0 00-.188.349l-.816 3.063a.75.75 0 00.92.92l3.062-.816a.75.75 0 00.35-.188l7.962-7.963a1.75 1.75 0 000-2.475l-.853-.853zM11.72 3.22a.25.25 0 01.354 0l.853.853a.25.25 0 010 .354L12 5.354 10.646 4l.927-.927l.146-.146v-.001z" />
              </svg>
              rename
            </button>
            <button
              onClick={() => startDelete(convo.id)}
              className="flex w-full items-center gap-2 px-3.5 py-2 text-[11px] tracking-[0.04em] text-her-accent/60 transition-colors hover:bg-her-accent/[0.05] hover:text-her-accent/80"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 000 1.5h.3l.815 8.15A1.5 1.5 0 005.357 15h5.285a1.5 1.5 0 001.493-1.35l.815-8.15h.3a.75.75 0 000-1.5H11v-.75A2.25 2.25 0 008.75 1h-1.5A2.25 2.25 0 005 3.25zm2.25-.75a.75.75 0 00-.75.75V4h3v-.75a.75.75 0 00-.75-.75h-1.5zM6.05 6a.75.75 0 01.787.713l.275 5.5a.75.75 0 01-1.498.075l-.275-5.5A.75.75 0 016.05 6zm3.9 0a.75.75 0 01.712.788l-.275 5.5a.75.75 0 01-1.498-.075l.275-5.5A.75.75 0 019.95 6z" clipRule="evenodd" />
              </svg>
              delete
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-her-text/10 backdrop-blur-[2px] transition-opacity duration-300 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => {
          setMenuOpenId(null);
          onClose();
        }}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chat history"
        tabIndex={-1}
        className={`history-drawer fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[80vw] flex-col border-r border-her-border/20 bg-her-bg shadow-lg transition-transform duration-300 ease-out sm:w-[300px] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        onClick={() => setMenuOpenId(null)}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-center gap-2">
            <div className="animate-breathe h-[5px] w-[5px] rounded-full bg-her-accent/60" />
            <h2 className="text-[12px] font-light tracking-[0.15em] text-her-text-muted/60">
              conversations
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-her-text-muted/30 transition-colors hover:text-her-text-muted/60"
            aria-label="Close history"
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
        </div>

        {/* Identity strip — quiet, sits above everything */}
        <div className="px-5 pb-3 sm:px-6">
          {isAuthenticated && userLabel ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-her-border/15 bg-her-surface/15 px-3.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-[6px] w-[6px] shrink-0 rounded-full bg-her-accent/55" />
                <span className="truncate text-[11px] tracking-[0.04em] text-her-text-muted/70" title={user?.email || ""}>
                  {userLabel}
                </span>
              </div>
              <button
                onClick={signOut}
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] tracking-[0.08em] text-her-text-muted/35 transition-colors duration-300 hover:text-her-accent/70"
                aria-label="Sign out"
              >
                sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              aria-label="Sign in"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-her-border/25 bg-her-surface/20 px-3.5 py-2.5 text-[11px] tracking-[0.06em] text-her-text-muted/55 transition-all duration-300 hover:border-her-accent/25 hover:bg-her-accent/[0.04] hover:text-her-text-muted/75 active:scale-[0.98]"
            >
              <div className="animate-breathe h-[6px] w-[6px] rounded-full bg-her-accent/50" />
              sign in
            </button>
          )}
        </div>

        {/* New chat button */}
        {isAuthenticated && (
          <div className="px-5 pb-2 sm:px-6">
            <button
              onClick={handleNewChat}
              aria-label="Start a new chat"
              className="flex w-full items-center gap-2 rounded-xl border border-her-border/25 bg-her-surface/20 px-3.5 py-2.5 text-[11px] tracking-[0.06em] text-her-text-muted/45 transition-all duration-300 hover:border-her-accent/20 hover:bg-her-accent/[0.04] hover:text-her-text-muted/65 active:scale-[0.98]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              new chat
            </button>
          </div>
        )}

        {/* Notifications row — same family as new-chat, slightly quieter */}
        {isAuthenticated && (
          <div className="px-5 pb-3 sm:px-6">
            <button
              onClick={() => setNotifyOpen(true)}
              aria-label="Notification settings"
              className="flex w-full items-center gap-2 rounded-xl px-3.5 py-2 text-[11px] tracking-[0.06em] text-her-text-muted/40 transition-all duration-300 hover:bg-her-surface/25 hover:text-her-text-muted/65 active:scale-[0.98]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path fillRule="evenodd" d="M10 2a6 6 0 00-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 00.515 1.076 32.91 32.91 0 003.256.508 3.5 3.5 0 006.972 0 32.903 32.903 0 003.256-.508.75.75 0 00.515-1.076A11.448 11.448 0 0116 8a6 6 0 00-6-6zM8.05 14.943a33.54 33.54 0 003.9 0 2 2 0 01-3.9 0z" clipRule="evenodd" />
              </svg>
              notifications
            </button>
          </div>
        )}

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto px-3 pb-6 sm:px-4">
          {/* Guest state */}
          {!isAuthenticated && (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="animate-breathe mb-4 h-[8px] w-[8px] rounded-full bg-her-accent/40" />
              <p className="text-[12px] leading-relaxed text-her-text-muted/40">
                sign in to keep your
                <br />
                conversations across devices
              </p>
            </div>
          )}

          {/* Loading state */}
          {isAuthenticated && loading && (
            <div className="flex h-32 items-center justify-center">
              <div className="animate-presence-breathe h-[6px] w-[6px] rounded-full bg-her-accent/40" />
            </div>
          )}

          {/* Empty state */}
          {isAuthenticated && !loading && conversations.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="animate-breathe mb-4 h-[7px] w-[7px] rounded-full bg-her-accent/30" />
              <p className="text-[12px] leading-relaxed text-her-text-muted/40">
                no conversations yet.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-her-text-muted/25">
                start a new chat and
                <br />
                she&apos;ll remember.
              </p>
            </div>
          )}

          {/* Grouped conversation list */}
          {isAuthenticated && !loading && conversations.length > 0 && (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 px-2 text-[9px] font-medium uppercase tracking-[0.18em] text-her-text-muted/25">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.conversations.map(renderConvoItem)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — back to landing, sits above the gradient hairline */}
        <div className="px-5 pb-2 pt-1 sm:px-6">
          <Link
            href="/"
            className="flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[10px] tracking-[0.12em] text-her-text-muted/30 transition-colors duration-300 hover:text-her-text-muted/60"
            aria-label="Back to landing page"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-2.5 w-2.5"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
            back to landing
          </Link>
        </div>

        {/* Subtle bottom border glow */}
        <div className="h-px bg-gradient-to-r from-transparent via-her-border/30 to-transparent" />
      </div>

      {/* Auth modal — relocated from header */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      {/* Notification settings panel — relocated from header */}
      <NotificationSettings
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        accessToken={accessToken ?? null}
      />
    </>
  );
}
