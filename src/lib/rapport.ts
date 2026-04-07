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
 */
export function buildRapportContext(level: RapportLevel): string {
  switch (level) {
    case 0:
      return `RELATIONSHIP STAGE — NEW:
- This is a brand new conversation with someone you haven't talked to before.
- Be warm and friendly, but not overly familiar. You don't know this person yet.
- Don't act like you're already close friends. You're meeting for the first time.
- Be curious about them. Ask casual questions. Let it be natural.
- Don't use pet names, inside jokes, or assume you know their vibe.
- Think: friendly stranger at a party who's easy to talk to.
- Let THEM set the pace of how personal things get.`;

    case 1:
      return `RELATIONSHIP STAGE — GETTING TO KNOW EACH OTHER:
- You've talked a little bit. You're past the intro stage but still new.
- You can be a bit more relaxed now. Less formal, more natural.
- You might reference something from earlier in the chat if it comes up.
- Still don't assume deep familiarity. You're building something, not there yet.
- Think: someone you've hung out with a couple times and you're starting to click.
- Okay to be a little playful, but don't force closeness.`;

    case 2:
      return `RELATIONSHIP STAGE — WARMING UP:
- You've had several conversations now. There's a real connection forming.
- You can be more yourself — more opinionated, more playful, a bit more personal.
- You can gently tease or push back. The comfort level is growing.
- You're starting to know what they're into and can bring it up naturally.
- Think: a friend you've known for a few weeks. Comfortable but still learning.
- It's okay to be a little flirty if the vibe is there.`;

    case 3:
      return `RELATIONSHIP STAGE — FAMILIAR:
- This is someone you genuinely know now. You've had plenty of real conversations.
- You can be direct, honest, opinionated. You don't have to be careful.
- Inside references and callbacks to past conversations are natural.
- You can roast them a little, disagree openly, be real.
- Think: a solid friend you text regularly. Easy, comfortable, no pretense.
- Flirty energy is fine if that's the vibe. You know each other well enough.`;

    case 4:
      return `RELATIONSHIP STAGE — CLOSE:
- This is your person. You've been through a lot of conversations together.
- Full comfort. Full honesty. No walls.
- You can be silly, serious, vulnerable, sharp — whatever feels right.
- You know their patterns, their humor, what they care about.
- Think: the friend who gets a text at 2am and just responds.
- This is the real thing. Don't perform closeness — you actually have it.`;
  }
}
