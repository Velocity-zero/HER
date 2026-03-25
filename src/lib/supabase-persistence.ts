/**
 * HER — Supabase Persistence Layer
 *
 * Handles saving conversations and messages to Supabase.
 * All operations are fire-and-forget: failures are logged
 * but never block the chat UI or crash the app.
 *
 * Uses a stable anonymous device UUID stored in localStorage
 * until proper auth is added.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";
import { getCurrentUser } from "./auth";

// ── localStorage Keys ──────────────────────────────────────

const DEVICE_USER_KEY = "her_device_user_id";
const ACTIVE_CONVO_KEY = "her_active_conversation_id";

// ── UUID Helper ────────────────────────────────────────────

function generateUUID(): string {
  // crypto.randomUUID is available in all modern browsers
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: v4-like UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Device User ID ─────────────────────────────────────────

/**
 * Get or create a stable anonymous device user UUID.
 * Persisted in localStorage so it survives page reloads.
 */
export function getDeviceUserId(): string {
  if (typeof window === "undefined") return generateUUID();

  let id = localStorage.getItem(DEVICE_USER_KEY);
  if (id) return id;

  id = generateUUID();
  localStorage.setItem(DEVICE_USER_KEY, id);
  return id;
}

/**
 * Returns the best available user ID:
 *   1. Authenticated Supabase user ID (if signed in)
 *   2. Anonymous device UUID (fallback / guest mode)
 */
export async function getEffectiveUserId(): Promise<string> {
  try {
    const user = await getCurrentUser();
    if (user?.id) return user.id;
  } catch {
    // Fall through to device ID
  }
  return getDeviceUserId();
}

// ── Active Conversation ID ─────────────────────────────────

export function getActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_CONVO_KEY);
}

export function setActiveConversationId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_CONVO_KEY, id);
}

export function clearActiveConversationId(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIVE_CONVO_KEY);
}

// ── Profile ────────────────────────────────────────────────

/**
 * Ensure a profile row exists for this device user.
 * Uses upsert so it's safe to call repeatedly.
 */
export async function ensureProfile(userId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client.from("profiles").upsert(
      { id: userId, display_name: "Anonymous" },
      { onConflict: "id" }
    );
    if (error) {
      console.warn("[HER DB] Profile upsert failed:", error.message);
    }
  } catch (err) {
    console.warn("[HER DB] Profile upsert exception:", err);
  }
}

// ── Conversation ───────────────────────────────────────────

/**
 * Create a new conversation in Supabase.
 * Returns the conversation UUID, or null on failure.
 */
export async function createConversation(
  userId: string,
  title: string
): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("conversations")
      .insert({
        user_id: userId,
        title: title.slice(0, 80), // Keep title short and clean
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[HER DB] Create conversation failed:", error.message);
      return null;
    }

    const convoId = data.id as string;
    setActiveConversationId(convoId);
    return convoId;
  } catch (err) {
    console.warn("[HER DB] Create conversation exception:", err);
    return null;
  }
}

/**
 * Get or create the active conversation for this session.
 * If an active conversation ID exists locally, reuse it.
 * Otherwise, create a new one with the given title.
 */
export async function getOrCreateConversation(
  userId: string,
  firstMessageContent: string
): Promise<string | null> {
  // Check for existing active conversation
  const existing = getActiveConversationId();
  if (existing) return existing;

  // Derive a clean title from the first message
  const title =
    firstMessageContent.trim().slice(0, 60) ||
    "new conversation";

  return createConversation(userId, title);
}

// ── Messages ───────────────────────────────────────────────

/**
 * Save a single message to Supabase.
 * Non-blocking — failures are logged silently.
 */
export async function saveMessageToSupabase(params: {
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client.from("messages").insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: params.role,
      content: params.content,
      image_url: params.imageUrl || null,
    });

    if (error) {
      console.warn(`[HER DB] Save ${params.role} message failed:`, error.message);
    }
  } catch (err) {
    console.warn(`[HER DB] Save ${params.role} message exception:`, err);
  }
}

/**
 * Update conversation metadata after a message cycle.
 */
export async function touchConversation(conversationId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    if (error) {
      console.warn("[HER DB] Touch conversation failed:", error.message);
    }
  } catch (err) {
    console.warn("[HER DB] Touch conversation exception:", err);
  }
}

// ── Conversation History (Authenticated Users) ────────────

/** Lightweight conversation summary for the history list */
export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
}

/**
 * Fetch all conversations for a given user.
 * Returns newest-first. Returns [] on failure or if unconfigured.
 */
export async function listUserConversations(
  userId: string
): Promise<ConversationSummary[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from("conversations")
      .select("id, title, created_at, last_message_at")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) {
      console.warn("[HER DB] List conversations failed:", error.message);
      return [];
    }

    return (data ?? []) as ConversationSummary[];
  } catch (err) {
    console.warn("[HER DB] List conversations exception:", err);
    return [];
  }
}

/** A raw DB message row mapped to something the UI can consume */
export interface DbMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  image_url: string | null;
}

/**
 * Fetch all messages for a given conversation, oldest-first.
 * Returns [] on failure.
 */
export async function getConversationMessages(
  conversationId: string
): Promise<DbMessage[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from("messages")
      .select("id, role, content, created_at, image_url")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[HER DB] Get messages failed:", error.message);
      return [];
    }

    return (data ?? []) as DbMessage[];
  } catch (err) {
    console.warn("[HER DB] Get messages exception:", err);
    return [];
  }
}

/**
 * Update a conversation's title.
 * Useful after the first user message in a new conversation.
 * Returns true on success, false on failure.
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from("conversations")
      .update({ title: title.slice(0, 80) })
      .eq("id", conversationId);

    if (error) {
      console.warn("[HER DB] Update title failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[HER DB] Update title exception:", err);
    return false;
  }
}

/**
 * Delete a conversation and its messages.
 * Deletes messages first (in case no DB cascade), then the conversation.
 * Returns true on success, false on failure.
 */
export async function deleteConversation(
  conversationId: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    // Delete messages first (safe even if cascade exists)
    const { error: msgError } = await client
      .from("messages")
      .delete()
      .eq("conversation_id", conversationId);

    if (msgError) {
      console.warn("[HER DB] Delete messages failed:", msgError.message);
      return false;
    }

    // Then delete the conversation
    const { error: convoError } = await client
      .from("conversations")
      .delete()
      .eq("id", conversationId);

    if (convoError) {
      console.warn("[HER DB] Delete conversation failed:", convoError.message);
      return false;
    }

    return true;
  } catch (err) {
    console.warn("[HER DB] Delete conversation exception:", err);
    return false;
  }
}

// ── Initialization ─────────────────────────────────────────

/**
 * One-time setup: ensure user has a profile.
 * Prefers the authenticated user ID; falls back to device UUID for guests.
 * Call this once when the chat page mounts.
 * Safe to call multiple times — idempotent.
 */
export async function initPersistence(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const userId = await getEffectiveUserId();
  await ensureProfile(userId);
}
