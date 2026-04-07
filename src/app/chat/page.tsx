"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Message } from "@/lib/types";
import { generateId, loadSession, saveMessages, clearSession } from "@/lib/chat-store";
import { createSurfaceCopyBundle, GREETING_POOL, type SurfaceCopyBundle } from "@/lib/surface-copy";
import { buildContinuity, buildContinuityBlock } from "@/lib/continuity";
import {
  initPersistence,
  getEffectiveUserId,
  getOrCreateConversation,
  saveMessageToSupabase,
  touchConversation,
  clearActiveConversationId,
  setActiveConversationId,
  getActiveConversationId,
  listUserConversations,
  getConversationMessages,
  updateConversationTitle,
  deleteConversation,
  getUserRapportStats,
  type ConversationSummary,
  type DbMessage,
} from "@/lib/supabase-persistence";
import { computeRapportLevel, type RapportLevel } from "@/lib/rapport";
import { useAuth } from "@/components/AuthProvider";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatWindow from "@/components/chat/ChatWindow";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import HistoryDrawer from "@/components/chat/HistoryDrawer";
import EmptyState from "@/components/chat/EmptyState";
import ImageStudio from "@/components/chat/ImageStudio";
import ModeSelector from "@/components/chat/ModeSelector";
import type { ImageStudioMode, ConversationMode } from "@/lib/types";

/**
 * HER opens every conversation with a greeting.
 * Uses a stable timestamp (0) to avoid SSR/client hydration mismatch.
 */
function createGreeting(content: string): Message {
  return {
    id: "greeting",
    role: "assistant",
    content,
    timestamp: 0,
  };
}

/** Convert a Supabase DB message to the UI Message shape */
function dbMessageToUiMessage(dbMsg: DbMessage): Message {
  return {
    id: dbMsg.id,
    role: dbMsg.role,
    content: dbMsg.content,
    timestamp: new Date(dbMsg.created_at).getTime(),
    ...(dbMsg.image_url ? { image: dbMsg.image_url } : {}),
  };
}

// ── Image-intent detection ──

const IMAGE_PATTERNS = [
  /\b(generate|create|make|paint|draw|sketch|design)\b.{0,20}\b(image|picture|photo|illustration|art|painting|portrait|drawing)\b/i,
  /\b(imagine|visualize)\b.{0,30}\b(of|for|with|a|an|the|me)\b/i,
  /\b(can you draw|can you paint|can you create|can you make)\b.{0,20}\b(image|picture|photo|illustration|art|painting|portrait|drawing|a|an|the|me)\b/i,
  /\bdraw\s+(me\s+)?a\b(?!\s+(bath|blank|conclusion|line|comparison|parallel|breath|crowd|salary|paycheck))/i,
  /\bpaint\s+(me\s+)?a\b/i,
  /\bsketch\s+(me\s+)?a\b/i,
];

/** Phrases that look like image requests but aren't */
const IMAGE_NEGATIVE_PATTERNS = [
  /\bdraw\s+(a\s+)?bath\b/i,
  /\bdraw\s+(a\s+)?(blank|conclusion|line|comparison|parallel|breath)\b/i,
  /\bpicture\s+(this|that|it)\b/i,
  /\bcan\s+you\s+picture\b/i,
  /\bshow\s+me\s+(how|what|where|why|when|around|the\s+way)\b/i,
  /\bbig\s+picture\b/i,
  /\bget\s+the\s+picture\b/i,
  /\bpaint\s+(a\s+)?picture\s+of\s+(what|how|the\s+situation)\b/i,
  /\bdraw\s+(a\s+)?line\b/i,
  /\bcreate\s+(a\s+)?(plan|list|schedule|account|profile|password|playlist)\b/i,
  /\bmake\s+(a\s+)?(plan|list|decision|choice|call|point|deal|joke|move|mess|mistake|change|difference)\b/i,
  /\bdesign\s+(a\s+)?(plan|system|strategy|approach|workflow|process)\b/i,
];

/** Detect if a user message is asking for image generation */
function isImageRequest(text: string): boolean {
  // Check negative patterns first — bail out if it's a common phrase
  if (IMAGE_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return IMAGE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Strip the intent keywords from the prompt to get a cleaner image description */
function extractImagePrompt(text: string): string {
  let prompt = text
    .replace(/\b(please|can you|could you|would you|i'd like you to|i want you to)\b/gi, "")
    .replace(/\b(generate|create|make|draw|sketch|design|paint|imagine|visualize|picture|show me)\b/gi, "")
    .replace(/\b(an? |the |me |of |for )\b/gi, " ")
    .replace(/\b(image|picture|photo|illustration|art|painting|portrait|drawing)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // If stripping removed everything meaningful, use the original text
  if (prompt.length < 5) prompt = text.trim();

  return prompt;
}

export default function ChatPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  // ── Surface copy bundle (session-stable, regenerates on New Chat) ──
  const [surfaceCopy, setSurfaceCopy] = useState<SurfaceCopyBundle>(() => createSurfaceCopyBundle());

  // ── Core chat state ──
  // Initial greeting uses the first pool item for SSR stability — overwritten by hydration useEffect
  const [messages, setMessages] = useState<Message[]>(() => [createGreeting(GREETING_POOL[0])]);
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // ── History state (authenticated users only) ──
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [loadingConvo, setLoadingConvo] = useState(false);

  // Prevent double-sends
  const sendingRef = useRef(false);

  // Abort controller — cancel in-flight requests on conversation switch or unmount
  const abortRef = useRef<AbortController | null>(null);

  // ── Empty state / suggestion chip prefill ──
  const [prefillText, setPrefillText] = useState<string | null>(null);

  // Session key — increments on session switch to trigger fade animation
  const [sessionKey, setSessionKey] = useState(0);

  // Scroll trigger — increments during streaming to keep auto-scroll working
  const [scrollTrigger, setScrollTrigger] = useState(0);

  // ── Image Studio state ──
  const [studioOpen, setStudioOpen] = useState(false);
  const [lastRevisedPrompt, setLastRevisedPrompt] = useState<string | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);

  // ── Ref for studio prefill (reuse prompt / edit source) ──
  const [studioPrefill, setStudioPrefill] = useState<{
    prompt?: string;
    mode?: "create" | "edit";
    sourceImage?: string;
  } | null>(null);
  const [studioKey, setStudioKey] = useState(0);

  // ── Conversation mode ──
  const [conversationMode, setConversationMode] = useState<ConversationMode>("default");

  // ── Retry state — stores the last failed user message for retry ──
  const [retryContent, setRetryContent] = useState<{ content: string; image?: string } | null>(null);

  // ── Rapport system — progressive bonding ──
  const [rapportLevel, setRapportLevel] = useState<RapportLevel>(0);
  const rapportStatsRef = useRef({ totalConversations: 0, totalUserMessages: 0 });

  // Fetch rapport stats once on mount (fire-and-forget)
  useEffect(() => {
    getEffectiveUserId().then((userId) =>
      getUserRapportStats(userId).then((stats) => {
        rapportStatsRef.current = stats;
        const currentUserMsgs = messages.filter((m) => m.role === "user").length;
        const level = computeRapportLevel({
          ...stats,
          currentMessageCount: currentUserMsgs,
        });
        setRapportLevel(level);

        // If rapport > 0, regenerate surface copy with appropriate greetings
        // (only if still on the initial greeting — don't disrupt ongoing chat)
        if (level > 0 && messages.length === 1 && messages[0].id === "greeting") {
          const freshCopy = createSurfaceCopyBundle(level);
          setSurfaceCopy(freshCopy);
          setMessages([createGreeting(freshCopy.greeting)]);
        }
      })
    ).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Restore from localStorage (client-only, after hydration) ──
  useEffect(() => {
    const saved = loadSession();
    if (saved && saved.messages.length > 0) {
      setMessages(saved.messages);
    } else {
      setMessages([createGreeting(surfaceCopy.greeting)]);
    }
    setHydrated(true);

    // Restore active conversation ID from localStorage
    const storedConvoId = getActiveConversationId();
    if (storedConvoId) setActiveConvoId(storedConvoId);

    // Initialize Supabase persistence (device profile) — fire-and-forget
    initPersistence().catch(() => {});
  }, []);

  // ── Load conversation history when auth resolves ──
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !user?.id) return;

    let cancelled = false;
    setHistoryLoading(true);

    listUserConversations(user.id).then((convos) => {
      if (!cancelled) {
        setConversations(convos);
        setHistoryLoading(false);

        // If we have a stored active convo ID and it's in the list, load it
        const storedId = getActiveConversationId();
        if (storedId && convos.some((c) => c.id === storedId)) {
          loadConversationMessages(storedId);
        }
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, user?.id]);

  // ── Persist whenever messages change (skip the first server render) ──
  // Filter out in-flight placeholders (imageLoading) so they never leak to storage
  useEffect(() => {
    if (!hydrated) return;
    const persistable = messages.filter((m) => !m.imageLoading);
    saveMessages(persistable);
  }, [messages, hydrated]);

  // ── Load messages for a specific conversation ──
  const loadConversationMessages = useCallback(async (conversationId: string) => {
    // Cancel any in-flight request from the previous conversation
    abortRef.current?.abort();
    abortRef.current = null;

    setLoadingConvo(true);
    const dbMessages = await getConversationMessages(conversationId);

    if (dbMessages.length > 0) {
      const uiMessages: Message[] = dbMessages.map(dbMessageToUiMessage);
      setMessages(uiMessages);
    } else {
      // Conversation exists but has no messages — show greeting
      setMessages([createGreeting(surfaceCopy.greeting)]);
    }

    setActiveConvoId(conversationId);
    setActiveConversationId(conversationId);
    setLoadingConvo(false);
    setIsTyping(false);
    setIsStreaming(false);
    setStudioOpen(false);
    setLastRevisedPrompt(null);
    setStudioError(null);
    setRetryContent(null);
    sendingRef.current = false;
    setSessionKey((k) => k + 1);
    setError(null);
  }, []);

  // ── Select a conversation from history ──
  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      // Guard: skip if already loading or selecting the same conversation
      if (loadingConvo || conversationId === activeConvoId) return;
      loadConversationMessages(conversationId);
    },
    [loadConversationMessages, loadingConvo, activeConvoId]
  );

  // ── Refresh the conversation list (e.g. after a new message) ──
  const refreshConversations = useCallback(async () => {
    if (!isAuthenticated || !user?.id) return;
    const convos = await listUserConversations(user.id);
    setConversations(convos);
  }, [isAuthenticated, user?.id]);

  // ── Local microcopy pools (no API calls — instant, zero latency) ──
  const LOCAL_VISION = ["okay let me see…", "looking…"];
  const LOCAL_IMAGE = [surfaceCopy.imageGeneratingLabel, "working on it…"];
  const LOCAL_IMAGE_CAPTIONS = ["here you go", "okay how's this"];
  const LOCAL_IMAGE_FAIL = [
    "that didn't work — try again?",
    "image generation broke — give it another shot?",
  ];
  const LOCAL_VISION_FAIL = [
    "couldn't read that image — try another one?",
    "got nothing from that — try again?",
  ];

  const pickRandom = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

  // ── Send a message (with streaming response) ──
  const handleSend = useCallback(async (content: string, image?: string) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: content || (image ? "(shared a photo)" : ""),
      timestamp: Date.now(),
      ...(image ? { image } : {}),
    };

    // Use functional updater to avoid stale closure over `messages`
    let updatedMessages: Message[] = [];
    setMessages((prev) => {
      updatedMessages = [...prev, userMessage];
      return updatedMessages;
    });
    setIsTyping(true);

    // ── Persist user message to Supabase (fire-and-forget) ──
    const userId = await getEffectiveUserId();
    let convoId = activeConvoId;

    // If no active conversation, create one
    if (!convoId) {
      convoId = await getOrCreateConversation(userId, userMessage.content).catch(() => null);
      if (convoId) {
        setActiveConvoId(convoId);
        setActiveConversationId(convoId);
      }
    } else {
      // ── Smart session title: update title from first real user message ──
      const userMsgCount = updatedMessages.filter((m) => m.role === "user").length;
      if (userMsgCount === 1) {
        const raw = userMessage.content.trim();
        if (raw && raw !== "(shared a photo)") {
          const title = raw.length > 50 ? raw.slice(0, 50).trimEnd() + "\u2026" : raw;
          updateConversationTitle(convoId, title).then((ok) => {
            if (ok) {
              setConversations((prev) =>
                prev.map((c) => (c.id === convoId ? { ...c, title } : c))
              );
            }
          }).catch(() => {});
        }
      }
    }

    if (convoId) {
      saveMessageToSupabase({
        conversationId: convoId,
        userId,
        role: "user",
        content: userMessage.content,
        imageUrl: image || undefined,
      }).catch(() => {});
    }

    // Create a stable ID for the streaming assistant message
    const herMessageId = generateId();

    // ── Human pacing — brief pause so responses don't feel instant ──
    const humanDelay = () =>
      new Promise<void>((r) => setTimeout(r, 350 + Math.random() * 550));

    // ── Vision analysis branch (user uploaded an image) ──
    if (image) {
      const visionPrompt = content || "Describe this image in detail.";

      try {
        // Show placeholder while vision model analyzes
        setIsTyping(false);
        setIsStreaming(true);

        const herPlaceholder: Message = {
          id: herMessageId,
          role: "assistant",
          content: pickRandom(LOCAL_VISION),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, herPlaceholder]);
        setScrollTrigger((n) => n + 1);

        await humanDelay();

        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, prompt: visionPrompt }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Failed to analyze image" }));
          throw new Error(errData.error || pickRandom(LOCAL_VISION_FAIL));
        }

        const data = await res.json();

        if (!data.message) {
          throw new Error(pickRandom(LOCAL_VISION_FAIL));
        }

        // ── Vision complete — finalize ──
        setMessages((prev) =>
          prev.map((m) =>
            m.id === herMessageId
              ? { ...m, content: data.message, timestamp: Date.now() }
              : m
          )
        );
        setScrollTrigger((n) => n + 1);

        // ── Persist assistant vision response to Supabase ──
        if (convoId) {
          saveMessageToSupabase({
            conversationId: convoId,
            userId,
            role: "assistant",
            content: data.message,
          }).catch(() => {});
          touchConversation(convoId).catch(() => {});
          refreshConversations().catch(() => {});
        }
      } catch (err) {
        // Silently ignore aborted requests (user switched conversation)
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const msg = err instanceof Error ? err.message : "something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== herMessageId));
      } finally {
        setIsTyping(false);
        setIsStreaming(false);
        sendingRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
      return; // Exit early — vision path complete
    }

    // ── Image generation branch ──
    if (isImageRequest(content)) {
      const imagePrompt = extractImagePrompt(content);

      try {
        // Transition: show typing then show placeholder with imageLoading
        setIsTyping(false);
        setIsStreaming(true);

        const herPlaceholder: Message = {
          id: herMessageId,
          role: "assistant",
          content: pickRandom(LOCAL_IMAGE),
          timestamp: Date.now(),
          imageLoading: true,
        };
        setMessages((prev) => [...prev, herPlaceholder]);
        setScrollTrigger((n) => n + 1);

        await humanDelay();

        const res = await fetch("/api/imagine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: imagePrompt }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Failed to generate image" }));
          throw new Error(errData.error || pickRandom(LOCAL_IMAGE_FAIL));
        }

        const data = await res.json();

        if (!data.image) {
          throw new Error(pickRandom(LOCAL_IMAGE_FAIL));
        }

        // ── Image generated — finalize ──
        const captionText = pickRandom(LOCAL_IMAGE_CAPTIONS);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === herMessageId
              ? { ...m, content: captionText, image: data.image, imageLoading: false, timestamp: Date.now() }
              : m
          )
        );
        setScrollTrigger((n) => n + 1);

        // ── Persist assistant image message to Supabase ──
        if (convoId) {
          saveMessageToSupabase({
            conversationId: convoId,
            userId,
            role: "assistant",
            content: captionText,
            imageUrl: data.image,
          }).catch(() => {});
          touchConversation(convoId).catch(() => {});
          refreshConversations().catch(() => {});
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const msg = err instanceof Error ? err.message : "something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== herMessageId));
      } finally {
        setIsTyping(false);
        setIsStreaming(false);
        sendingRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
      return; // Exit early — image path complete
    }

    // ── Text streaming branch (existing) ──

    // Compute conversation continuity for anti-repetition
    const continuity = buildContinuity(updatedMessages);
    const continuityContext = buildContinuityBlock(continuity) ?? undefined;

    // Update rapport level with current message count
    const currentUserMsgs = updatedMessages.filter((m) => m.role === "user").length;
    const currentRapport = computeRapportLevel({
      ...rapportStatsRef.current,
      currentMessageCount: currentUserMsgs,
    });
    setRapportLevel(currentRapport);

    try {
      const res = await fetch("/api/chat?stream=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages, mode: conversationMode, rapportLevel: currentRapport, continuityContext }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Non-streaming error (e.g. 400, 429, 502)
        const errorText = await res.text();
        throw new Error(errorText || "Failed to get a response");
      }

      // ── Transition from typing indicator to streaming text ──
      setIsTyping(false);
      setIsStreaming(true);

      // Insert placeholder — starts empty (triggers "thinking…" in MessageBubble)
      const herPlaceholder: Message = {
        id: herMessageId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, herPlaceholder]);

      await humanDelay();

      // ── Read the stream chunk by chunk ──
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;

        // Update the assistant message in-place
        const textSoFar = fullText;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === herMessageId ? { ...m, content: textSoFar } : m
          )
        );
        // Trigger scroll to keep up with growing text
        setScrollTrigger((n) => n + 1);
      }

      // ── Stream complete — finalize ──
      if (!fullText) {
        throw new Error("wait something broke on my end — try that again?");
      }

      // Ensure final state is clean
      setMessages((prev) =>
        prev.map((m) =>
          m.id === herMessageId
            ? { ...m, content: fullText, timestamp: Date.now() }
            : m
        )
      );

      // Clear retry state on success
      setRetryContent(null);

      // ── Persist FINAL assistant message to Supabase (fire-and-forget) ──
      if (convoId) {
        saveMessageToSupabase({
          conversationId: convoId,
          userId,
          role: "assistant",
          content: fullText,
        }).catch(() => {});
        touchConversation(convoId).catch(() => {});

        // Refresh conversation list for authenticated users
        refreshConversations().catch(() => {});
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const msg = err instanceof Error ? err.message : "something went wrong";
      setError(msg);

      // Store retry info so user can try again
      setRetryContent({ content: userMessage.content, image: image ?? undefined });

      // Remove the empty/partial placeholder if stream failed
      setMessages((prev) => prev.filter((m) => m.id !== herMessageId));
    } finally {
      setIsTyping(false);
      setIsStreaming(false);
      sendingRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [activeConvoId, refreshConversations, conversationMode]);
  const handleRetry = useCallback(() => {
    if (!retryContent) return;
    setError(null);
    setRetryContent(null);
    // Remove the last user message (we'll re-send it)
    setMessages((prev) => {
      // Find last user message and remove it
      const lastUserIdx = [...prev].reverse().findIndex((m) => m.role === "user");
      if (lastUserIdx === -1) return prev;
      const idx = prev.length - 1 - lastUserIdx;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    // Re-send
    handleSend(retryContent.content, retryContent.image);
  }, [retryContent, handleSend]);

  // ── Friendly error mapper for Image Studio ──
  function mapStudioError(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes("api key") || lower.includes("envkey") || lower.includes("configure") || lower.includes("missing") || lower.includes("unauthorized")) {
      return "she can't create right now — the image service key isn't working.";
    }
    if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many")) {
      return "too many requests — give it about 30 seconds and try again.";
    }
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("gateway") || lower.includes("abort")) {
      return "that took too long. try again in a moment.";
    }
    if (lower.includes("(422)") || lower.includes("rejected the request") || lower.includes("payload")) {
      return "those settings didn't quite work. try adjusting the prompt or switching to Recommended.";
    }
    if (lower.includes("unavailable") || lower.includes("overload") || lower.includes("503") || lower.includes("502") || lower.includes("unsupported model") || lower.includes("not be supported")) {
      return "the image service is taking a break. try once more, or switch to Recommended for the most reliable results.";
    }
    if (lower.includes("unexpected response")) {
      return "the image came back in a format she didn't recognize. try once more, or Recommended tends to be the most reliable.";
    }
    if (lower.includes("image") && (lower.includes("invalid") || lower.includes("read") || lower.includes("decode") || lower.includes("unsupported"))) {
      return "she couldn't read that image clearly. try a different one.";
    }
    // Fallback — include a hint of the real error for debugging
    console.warn("[HER Studio] Unmapped error:", raw);
    return "something went wrong. try once more, or switch to Recommended for the most reliable results.";
  }

  // ── Image Studio generation handler ──
  const handleStudioGenerate = useCallback(async (request: {
    prompt: string;
    modelId: string;
    mode: ImageStudioMode;
    aspect_ratio?: string;
    steps?: number;
    cfg_scale?: number;
    negative_prompt?: string;
    seed?: number;
    image?: string;
  }) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setStudioError(null);
    setStudioOpen(false);
    setLastRevisedPrompt(null);

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Add user message (shows what the user asked for)
    const userContent = request.mode === "edit"
      ? `✏️ ${request.prompt}`
      : `🎨 ${request.prompt}`;

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: userContent,
      timestamp: Date.now(),
      ...(request.mode === "edit" && request.image ? { image: request.image } : {}),
    };

    let updatedMessages: Message[] = [];
    setMessages((prev) => {
      updatedMessages = [...prev, userMessage];
      return updatedMessages;
    });
    setIsTyping(true);

    // ── Persist user message to Supabase ──
    const userId = await getEffectiveUserId();
    let convoId = activeConvoId;

    if (!convoId) {
      convoId = await getOrCreateConversation(userId, userMessage.content).catch(() => null);
      if (convoId) {
        setActiveConvoId(convoId);
        setActiveConversationId(convoId);
      }
    } else {
      const userMsgCount = updatedMessages.filter((m) => m.role === "user").length;
      if (userMsgCount === 1) {
        const raw = userMessage.content.trim();
        if (raw && raw !== "(shared a photo)") {
          const title = raw.length > 50 ? raw.slice(0, 50).trimEnd() + "\u2026" : raw;
          updateConversationTitle(convoId, title).then((ok) => {
            if (ok) {
              setConversations((prev) =>
                prev.map((c) => (c.id === convoId ? { ...c, title } : c))
              );
            }
          }).catch(() => {});
        }
      }
    }

    if (convoId) {
      saveMessageToSupabase({
        conversationId: convoId,
        userId,
        role: "user",
        content: userMessage.content,
        imageUrl: request.mode === "edit" ? request.image : undefined,
      }).catch(() => {});
    }

    const herMessageId = generateId();

    const humanDelay = () =>
      new Promise<void>((r) => setTimeout(r, 350 + Math.random() * 550));

    try {
      setIsTyping(false);
      setIsStreaming(true);

      const herPlaceholder: Message = {
        id: herMessageId,
        role: "assistant",
        content: pickRandom(LOCAL_IMAGE),
        timestamp: Date.now(),
        imageLoading: true,
      };
      setMessages((prev) => [...prev, herPlaceholder]);
      setScrollTrigger((n) => n + 1);

      await humanDelay();

      const res = await fetch("/api/imagine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: request.prompt,
          modelId: request.modelId,
          mode: request.mode,
          aspect_ratio: request.aspect_ratio,
          steps: request.steps,
          cfg_scale: request.cfg_scale,
          negative_prompt: request.negative_prompt,
          seed: request.seed,
          image: request.image,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Failed to generate image" }));
        throw new Error(errData.error || pickRandom(LOCAL_IMAGE_FAIL));
      }

      const data = await res.json();
      if (!data.image) {
        throw new Error(pickRandom(LOCAL_IMAGE_FAIL));
      }

      // Store the optimized prompt if the server returned one
      // (visible next time the user opens the studio — no auto-reopen)
      if (data.revisedPrompt) {
        setLastRevisedPrompt(data.revisedPrompt);
      }

      const captionText = request.mode === "edit"
        ? pickRandom(["here's the edit", "done", "how's this"])
        : pickRandom(LOCAL_IMAGE_CAPTIONS);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === herMessageId
            ? { ...m, content: captionText, image: data.image, imageLoading: false, timestamp: Date.now() }
            : m
        )
      );
      setScrollTrigger((n) => n + 1);

      if (convoId) {
        saveMessageToSupabase({
          conversationId: convoId,
          userId,
          role: "assistant",
          content: captionText,
          imageUrl: data.image,
        }).catch(() => {});
        touchConversation(convoId).catch(() => {});
        refreshConversations().catch(() => {});
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const raw = err instanceof Error ? err.message : "something went wrong";
      const friendly = mapStudioError(raw);
      console.warn(`[HER Studio] Generation error (model: ${request.modelId}, mode: ${request.mode}):`, raw);
      setStudioError(friendly);
      setStudioOpen(true); // Re-open studio to show the inline error
      setMessages((prev) => prev.filter((m) => m.id !== herMessageId));
    } finally {
      setIsTyping(false);
      setIsStreaming(false);
      sendingRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [activeConvoId, refreshConversations]);

  // ── New chat / start over ──
  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearSession();
    clearActiveConversationId();
    setActiveConvoId(null);

    // Generate fresh surface copy for the new session
    const freshCopy = createSurfaceCopyBundle(rapportLevel);
    setSurfaceCopy(freshCopy);
    setMessages([createGreeting(freshCopy.greeting)]);

    setError(null);
    setIsTyping(false);
    setIsStreaming(false);
    setStudioOpen(false);
    setLastRevisedPrompt(null);
    setStudioError(null);
    setRetryContent(null);
    setConversationMode("default");
    sendingRef.current = false;
    setSessionKey((k) => k + 1);
  }, [rapportLevel]);

  // ── Rename a conversation ──
  const handleRenameConversation = useCallback(
    async (conversationId: string, title: string): Promise<boolean> => {
      const success = await updateConversationTitle(conversationId, title);
      if (success) {
        // Optimistically update the local list
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, title } : c))
        );
      }
      return success;
    },
    []
  );

  // ── Delete a conversation ──
  const handleDeleteConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      const success = await deleteConversation(conversationId);
      if (success) {
        // Remove from local list
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));

        // If we just deleted the active conversation, reset to a fresh chat
        if (conversationId === activeConvoId) {
          clearSession();
          clearActiveConversationId();
          setActiveConvoId(null);
          const freshCopy = createSurfaceCopyBundle(rapportLevel);
          setSurfaceCopy(freshCopy);
          setMessages([createGreeting(freshCopy.greeting)]);
          setError(null);
        }
      }
      return success;
    },
    [activeConvoId]
  );

  const dismissError = useCallback(() => setError(null), []);

  // ── Image action handlers (15J) ──

  const handleImageDownload = useCallback((imageUrl: string) => {
    try {
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = `her-image-${Date.now()}.png`;
      link.click();
    } catch {
      console.warn("[HER] Download failed");
    }
  }, []);

  const handleCopyPrompt = useCallback((prompt: string) => {
    navigator.clipboard?.writeText(prompt).catch(() => {});
  }, []);

  const handleReusePrompt = useCallback((prompt: string) => {
    setStudioPrefill({ prompt, mode: "create" });
    setStudioError(null);
    setStudioKey((k) => k + 1);
    setStudioOpen(true);
  }, []);

  const handleUseAsEditSource = useCallback((imageUrl: string) => {
    setStudioPrefill({ mode: "edit", sourceImage: imageUrl });
    setStudioError(null);
    setStudioKey((k) => k + 1);
    setStudioOpen(true);
  }, []);

  return (
    <div className="animate-page-enter flex h-full flex-col overflow-hidden bg-her-bg">
      <ChatHeader
        onClear={handleClear}
        onHistoryOpen={() => setHistoryOpen(true)}
      />

      {/* Conversation mode selector — auto-hides after a few seconds */}
      <ModeSelector
        mode={conversationMode}
        onChange={setConversationMode}
        disabled={isTyping || isStreaming}
      />

      {/* History drawer */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        activeConversationId={activeConvoId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleClear}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        isAuthenticated={isAuthenticated}
        loading={historyLoading}
      />

      {/* Loading overlay for conversation switch */}
      {loadingConvo && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-her-bg/70 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-presence-breathe h-2 w-2 rounded-full bg-her-accent/40" />
          </div>
        </div>
      )}

      <ChatWindow scrollTrigger={scrollTrigger}>
        <div key={sessionKey} className="animate-session-fade">
          {/* Empty state — shown when conversation only has the greeting */}
          {!isTyping && messages.length === 1 && messages[0].id === "greeting" && (
            <EmptyState
              onSuggestion={setPrefillText}
              suggestions={surfaceCopy.starterPrompts}
              openingLine={surfaceCopy.openingLine}
              openingSubtext={surfaceCopy.openingSubtext}
            />
          )}

          {/* Messages */}
          {messages.map((msg, i) => {
            const isGeneratedImage = !!msg.image && msg.role === "assistant" && !msg.imageLoading;

            // For generated images, find the preceding user prompt for copy/reuse
            let msgImageActions: {
              onDownload?: (imageUrl: string) => void;
              onCopyPrompt?: () => void;
              onReusePrompt?: () => void;
              onUseAsEditSource?: (imageUrl: string) => void;
            } | undefined;
            if (isGeneratedImage) {
              // Walk backwards to find the user message that triggered this generation
              let userPrompt = "";
              for (let j = i - 1; j >= 0; j--) {
                if (messages[j].role === "user") {
                  userPrompt = messages[j].content.replace(/^[🎨✏️]\s*/, "").trim();
                  break;
                }
              }
              msgImageActions = {
                onDownload: handleImageDownload,
                onCopyPrompt: userPrompt ? () => handleCopyPrompt(userPrompt) : undefined,
                onReusePrompt: userPrompt ? () => handleReusePrompt(userPrompt) : undefined,
                onUseAsEditSource: handleUseAsEditSource,
              };
            }

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                index={i}
                showTimestamp={!isStreaming && (i === 0 || i === messages.length - 1)}
                isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                imageActions={msgImageActions}
                thinkingLabel={surfaceCopy.thinkingLabel}
              />
            );
          })}
        </div>

        {/* Typing indicator */}
        {isTyping && <TypingIndicator label={surfaceCopy.thinkingLabel} />}

        {/* Error toast */}
        {error && (
          <div className="animate-fade-in mb-5 flex flex-col items-center gap-2 px-3 sm:px-0">
            <button
              onClick={dismissError}
              className="min-h-[44px] rounded-[18px] bg-her-accent/[0.05] px-5 py-3 text-[12px] leading-[1.5] text-her-accent/70 shadow-[0_1px_4px_rgba(180,140,110,0.04)] transition-colors duration-300 hover:bg-her-accent/[0.09] sm:px-6 sm:text-[13px]"
            >
              {error}
              <span className="ml-2.5 text-her-accent/25">✕</span>
            </button>
            {retryContent && (
              <button
                onClick={handleRetry}
                className="rounded-full border border-her-accent/15 px-4 py-1.5 text-[11px] tracking-[0.04em] text-her-accent/55 transition-all duration-200 hover:bg-her-accent/[0.06] hover:text-her-accent/75 active:scale-[0.96]"
              >
                try again
              </button>
            )}
          </div>
        )}
      </ChatWindow>

      {/* Image Studio — slides in above the composer */}
      {studioOpen && (
        <div className="shrink-0 border-t border-her-border/10 bg-her-bg/95 pb-2 pt-3">
          <ImageStudio
            key={studioKey}
            onGenerate={handleStudioGenerate}
            disabled={isTyping || isStreaming}
            onClose={() => setStudioOpen(false)}
            lastRevisedPrompt={lastRevisedPrompt}
            studioError={studioError}
            initialPrefill={studioPrefill}
            generatingLabel={surfaceCopy.imageGeneratingLabel}
            editingLabel={surfaceCopy.imageEditingLabel}
            promptPlaceholder={surfaceCopy.studioPlaceholder}
            onRetry={() => setStudioError(null)}
            onSwitchRecommended={() => setStudioError(null)}
          />
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        disabled={isTyping || isStreaming}
        prefillText={prefillText ?? undefined}
        onPrefillConsumed={() => setPrefillText(null)}
        onToggleStudio={() => setStudioOpen((v) => !v)}
        studioOpen={studioOpen}
      />
    </div>
  );
}
