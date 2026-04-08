import { Message, ChatSession } from "./types";

// ── Constants ──────────────────────────────────────────────

export const STORAGE_KEY = "her-chat-session";
const STORAGE_VERSION = 1;

// ── Helpers ────────────────────────────────────────────────

/**
 * Generate a simple unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ── Validation ─────────────────────────────────────────────

/**
 * Checks whether a stored value looks like a valid ChatSession.
 * Protects against corrupted or outdated data shapes.
 */
function isValidSession(data: unknown): data is ChatSession & { _v?: number } {
  if (!data || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== "string") return false;
  if (!Array.isArray(obj.messages)) return false;
  if (typeof obj.createdAt !== "number") return false;
  if (typeof obj.updatedAt !== "number") return false;

  // Validate every message has the right shape
  for (const msg of obj.messages) {
    if (!msg || typeof msg !== "object") return false;
    const m = msg as Record<string, unknown>;
    if (typeof m.id !== "string") return false;
    if (m.role !== "user" && m.role !== "assistant") return false;
    if (typeof m.content !== "string") return false;
    if (typeof m.timestamp !== "number") return false;
  }

  return true;
}

// ── Load / Save / Clear ────────────────────────────────────

/**
 * Load the current chat session from localStorage.
 * Returns null if nothing is stored, data is corrupted,
 * or we're running on the server (SSR).
 */
export function loadSession(): ChatSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);

    if (!isValidSession(parsed)) {
      console.warn("[HER store] Invalid session data — clearing.");
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed as ChatSession;
  } catch {
    // JSON.parse failed or localStorage threw — wipe it
    console.warn("[HER store] Corrupted session data — clearing.");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    return null;
  }
}

/** Cached session ID so we don't re-read localStorage on every save */
let _cachedSessionId: string | null = null;
let _cachedCreatedAt: number | null = null;

/** Debounce timer for saves during streaming */
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 300;

/**
 * Strip base64 data URLs from messages before persisting to localStorage.
 * Keeps Supabase image_url references (http/https) intact.
 * Prevents localStorage quota overflow from embedded images.
 */
function stripBase64Images(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (m.image && m.image.startsWith("data:")) {
      return { ...m, image: undefined };
    }
    return m;
  });
}

/**
 * Save the full message array to localStorage.
 * Wraps messages in a ChatSession envelope so the shape
 * is always consistent and swappable to a DB later.
 *
 * - Strips base64 images to avoid exceeding ~5 MB localStorage quota.
 * - Debounces saves (300ms) during rapid streaming updates.
 */
export function saveMessages(messages: Message[], immediate = false): void {
  if (typeof window === "undefined") return;

  const doSave = () => {
    try {
      // Use cached session metadata to avoid re-reading localStorage
      if (!_cachedSessionId) {
        const existing = loadSession();
        _cachedSessionId = existing?.id ?? generateId();
        _cachedCreatedAt = existing?.createdAt ?? Date.now();
      }

      const session: ChatSession & { _v: number } = {
        id: _cachedSessionId,
        messages: stripBase64Images(messages),
        createdAt: _cachedCreatedAt ?? Date.now(),
        updatedAt: Date.now(),
        _v: STORAGE_VERSION,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (error) {
      // QuotaExceededError — try saving without images as last resort
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        console.warn("[HER store] Quota exceeded — saving text-only messages.");
        try {
          const textOnly = messages.map(({ image, ...rest }) => rest);
          const session: ChatSession & { _v: number } = {
            id: _cachedSessionId ?? generateId(),
            messages: textOnly as Message[],
            createdAt: _cachedCreatedAt ?? Date.now(),
            updatedAt: Date.now(),
            _v: STORAGE_VERSION,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch {
          console.error("[HER store] Failed to save even text-only.");
        }
      } else {
        console.error("[HER store] Failed to save:", error);
      }
    }
  };

  if (immediate) {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    doSave();
  } else {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  }
}

/**
 * Clear the current session from localStorage
 */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  _cachedSessionId = null;
  _cachedCreatedAt = null;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}
