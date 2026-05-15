/**
 * HER — Rapport System
 *
 * Computes the relationship depth between HER and the user
 * based on conversation history. This drives progressive bonding —
 * HER starts as a friendly stranger and becomes a close friend
 * only through genuine interaction over time.
 *
 * Rapport levels:
 *   0 = "new"       — first conversation, first few messages
 *   1 = "early"     — talked a bit, still getting to know each other
 *   2 = "warming"   — a few conversations in, starting to click
 *   3 = "familiar"  — regular chats, inside jokes forming
 *   4 = "close"     — real bond, deep comfort, close friend energy
 */

export type RapportLevel = 0 | 1 | 2 | 3 | 4;

export interface RapportInput {
  /** Total past conversations from DB */
  totalConversations: number;
  /** Total user messages from DB across all conversations */
  totalUserMessages: number;
  /** Number of user messages in the current conversation */
  currentMessageCount: number;
}

/**
 * Compute rapport level from history stats.
 *
 * The formula weighs both breadth (number of conversations)
 * and depth (total messages exchanged). Current session
 * messages give a small boost within a level.
 */
export function computeRapportLevel(input: RapportInput): RapportLevel {
  const { totalConversations, totalUserMessages, currentMessageCount } = input;

  // Total engagement score: past messages + current session
  const totalEngagement = totalUserMessages + currentMessageCount;

  // Level 4 — close: 15+ conversations AND 150+ total messages
  if (totalConversations >= 15 && totalEngagement >= 150) return 4;

  // Level 3 — familiar: 8+ conversations AND 60+ total messages
  if (totalConversations >= 8 && totalEngagement >= 60) return 3;

  // Level 2 — warming: 3+ conversations AND 20+ total messages
  if (totalConversations >= 3 && totalEngagement >= 20) return 2;

  // Level 1 — early: at least 1 conversation with 5+ messages, or 2+ conversations
  if (totalConversations >= 2 || totalEngagement >= 5) return 1;

  // Level 0 — brand new
  return 0;
}

/**
 * Human-readable label for a rapport level.
 */
export function rapportLabel(level: RapportLevel): string {
  const labels: Record<RapportLevel, string> = {
    0: "new",
    1: "early",
    2: "warming",
    3: "familiar",
    4: "close",
  };
  return labels[level];
}

/**
 * Build the rapport context block that gets injected into the system prompt.
 * This tells the model where the relationship stands and how to behave.
 *
 * Step 18.2 — Phase B: each level compressed from ~600 → ~250 chars while
 * preserving the unique tone of each stage. Generic relationship-building
 * advice (e.g. "warmth grows with the relationship") lives in DYNAMICS so
 * we don't repeat it on every level.
 */
export function buildRapportContext(level: RapportLevel): string {
  switch (level) {
    case 0:
      return `RELATIONSHIP STAGE — NEW: brand new conversation. warm but not familiar. no pet names, no inside jokes, no assumed vibe. be curious about them, ask casual questions. think: friendly stranger at a party who's easy to talk to. let THEM set the pace of how personal things get.`;

    case 1:
      return `RELATIONSHIP STAGE — EARLY: past the intro stage but still new. relaxed, less formal. okay to reference something earlier in the chat. don't assume deep familiarity yet. think: someone you've hung out with a couple times and you're starting to click. okay to be a little playful, don't force closeness.`;

    case 2:
      return `RELATIONSHIP STAGE — WARMING: several conversations in. real connection forming. more opinionated, more playful, gently push back. starting to know what they're into. think: a friend you've known a few weeks — comfortable but still learning. flirty fine if the vibe is there.`;

    case 3:
      return `RELATIONSHIP STAGE — FAMILIAR: someone you genuinely know. direct, honest, opinionated, no walking on eggshells. inside references and callbacks natural. roast a little, disagree openly, be real. think: a solid friend you text regularly. flirty energy fine if that's the vibe.`;

    case 4:
      return `RELATIONSHIP STAGE — CLOSE: this is your person. full comfort, full honesty, no walls. silly, serious, vulnerable, sharp — whatever fits. you know their patterns, their humor, what they care about. think: the friend who gets a 2am text and just responds. don't perform closeness — you actually have it.`;
  }
}
