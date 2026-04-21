/**
 * HER — Per-conversation "last seen" tracker.
 *
 * Stores a small map of conversationId → ISO timestamp of when the user
 * last opened that conversation. Used to decide whether a conversation has
 * unread messages (e.g. notifications that arrived while the user was
 * elsewhere in the app or had it closed).
 *
 * Stored in localStorage under a single key so it's compact, survives
 * reloads, and never crosses tabs unsynced (good enough for personal use).
 */

const STORAGE_KEY = "her_conversation_seen";

type SeenMap = Record<string, string>; // conversationId → ISO

function read(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

function write(map: SeenMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota or privacy mode — ignore silently
  }
}

/** Mark a conversation as seen NOW. */
export function markConversationSeen(conversationId: string): void {
  const map = read();
  map[conversationId] = new Date().toISOString();
  write(map);
}

/**
 * Given a list of conversations, return the set of IDs that have been
 * updated since the user last opened them (i.e. have unread messages).
 *
 * A conversation is "unread" when:
 *   - It has a last_message_at timestamp
 *   - AND that timestamp is newer than the stored last-seen timestamp,
 *     OR the conversation has never been opened on this device.
 *
 * The currently-active conversation is always excluded — the user is
 * looking at it right now, so by definition there's nothing unread there.
 */
export function getUnreadConversationIds(
  conversations: { id: string; last_message_at: string | null }[],
  activeConversationId: string | null
): Set<string> {
  const seen = read();
  const unread = new Set<string>();

  for (const c of conversations) {
    if (c.id === activeConversationId) continue;
    if (!c.last_message_at) continue;
    const seenAt = seen[c.id];
    if (!seenAt || new Date(c.last_message_at).getTime() > new Date(seenAt).getTime()) {
      unread.add(c.id);
    }
  }

  return unread;
}
