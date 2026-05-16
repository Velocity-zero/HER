/**
 * HER — Conversation Continuity
 *
 * Lightweight per-chat memory that helps HER avoid repetition
 * and adapt naturally across turns. Computed entirely from the
 * existing message array — no extra model calls.
 *
 * Resets on:
 *   - New Chat
 *   - App refresh (runtime state only)
 *   - Conversation switch
 *
 * Does NOT persist across conversations.
 * Does NOT store private user profiles.
 */

import type { Message } from "./types";

// ── Types ──────────────────────────────────────────────────

export type InteractionMode =
  | "emotional"
  | "practical"
  | "creative"
  | "technical"
  | "playful"
  | "conversational";

export type EmotionalTone =
  | "calm"
  | "heavy"
  | "excited"
  | "uncertain"
  | "frustrated"
  | "playful"
  | "neutral";

export type AssistantMove =
  | "asked_question"
  | "emotional_checkin"
  | "reflected"
  | "advised"
  | "explained"
  | "created"
  | "comforted"
  | "joked"
  | "direct_answer"
  | "observation";

export interface ConversationContinuity {
  turnCount: number;
  recentModes: InteractionMode[];
  recentTone: EmotionalTone;
  recentAssistantMoves: AssistantMove[];
  recentAssistantOpenings: string[];
  questionStreak: number;
  lastUserIntent: InteractionMode;
}

// ── Constants ──────────────────────────────────────────────

const MAX_TRACKED_MOVES = 5;
const MAX_TRACKED_MODES = 4;
const MAX_TRACKED_OPENINGS = 4;

// ── Inference Helpers ──────────────────────────────────────

/**
 * Classify rough interaction mode from user message text.
 * Uses simple keyword/pattern heuristics — no model call.
 */
export function inferUserMode(text: string): InteractionMode {
  const t = text.toLowerCase();

  // Technical signals
  if (
    /\b(code|bug|error|function|api|debug|deploy|server|database|regex|typescript|javascript|python|css|html|git|npm|sql|compile|runtime)\b/.test(t) ||
    /```/.test(t) ||
    /\b(fix|broken|crash|stack\s?trace|exception|undefined|null)\b/.test(t)
  ) return "technical";

  // Practical/task signals
  if (
    /\b(plan|schedule|organize|list|steps|how\s+do\s+i|help\s+me\s+(with|plan|figure|draft|write\s+a|prepare))\b/.test(t) ||
    /\b(email|resume|agenda|meeting|budget|deadline)\b/.test(t)
  ) return "practical";

  // Creative signals
  if (
    /\b(write|story|poem|song|lyrics|imagine|design|create|draw|paint|sketch|brainstorm|idea|creative|art)\b/.test(t) ||
    /\b(prompt|concept|character|world\s?build)\b/.test(t)
  ) return "creative";

  // Emotional signals
  if (
    /\b(feel|feeling|sad|angry|anxious|scared|lonely|hurt|depressed|stressed|overwhelmed|cry|crying|vent|venting|upset|worried|afraid|lost|stuck|empty)\b/.test(t) ||
    /\b(i\s+can'?t|i\s+don'?t\s+know\s+what\s+to|i'?m\s+so\s+tired|i\s+need\s+to\s+talk)\b/.test(t)
  ) return "emotional";

  // Playful signals
  if (
    /\b(joke|funny|lol|haha|lmao|roast|dare|game|quiz|trivia|would\s+you\s+rather|surprise\s+me)\b/.test(t) ||
    /\b(bored|entertain|random|weird|wild)\b/.test(t)
  ) return "playful";

  return "conversational";
}

/**
 * Detect emotional energy/tone from user message.
 */
export function inferEmotionalTone(text: string): EmotionalTone {
  const t = text.toLowerCase();

  if (/\b(sad|hurt|crying|cry|depressed|lonely|empty|grief|loss|miss\b|missing)\b/.test(t)) return "heavy";
  if (/\b(angry|furious|pissed|annoyed|frustrated|ugh|sick\s+of|fed\s+up)\b/.test(t)) return "frustrated";
  if (/\b(worried|anxious|nervous|scared|afraid|unsure|confused|don'?t\s+know)\b/.test(t)) return "uncertain";
  if (/\b(excited|amazing|awesome|incredible|yay|omg|can'?t\s+wait|love\s+it|so\s+good)\b/.test(t) || /!{2,}/.test(t)) return "excited";
  if (/\b(haha|lol|lmao|😂|funny|joke)\b/.test(t)) return "playful";
  if (/\b(okay|fine|good|alright|chill|relaxed|peaceful)\b/.test(t)) return "calm";

  return "neutral";
}

/**
 * Classify what move an assistant message represents.
 * Looks at the shape/structure of the response, not deep semantics.
 */
export function classifyAssistantMove(text: string): AssistantMove {
  const t = text.toLowerCase();
  const trimmed = t.trim();

  // Ends with a question mark → likely question-led
  const endsWithQuestion = /\?[\s"'""'']*$/.test(trimmed);
  const questionCount = (trimmed.match(/\?/g) || []).length;

  // Emotional check-in patterns
  if (
    endsWithQuestion &&
    /\b(how\s+(are|have)\s+you|what'?s\s+(on\s+your\s+mind|been\s+sitting|going\s+on|happening|wrong|up)|you\s+okay|want\s+to\s+talk|how\s+are\s+you\s+feeling|everything\s+alright)\b/.test(t)
  ) return "emotional_checkin";

  // Comfort / emotional support
  if (
    /\b(i'?m\s+here|that\s+makes\s+sense|that\s+sounds\s+(hard|tough|rough|heavy)|i\s+hear\s+you|you'?re\s+not\s+alone|it'?s\s+okay\s+to)\b/.test(t) &&
    !endsWithQuestion
  ) return "comforted";

  // Joke / playful
  if (/\b(haha|lol|okay\s+but|honestly|😂|plot\s+twist)\b/.test(t) && t.length < 200) return "joked";

  // Code / technical explanation
  if (/```/.test(t) || /\b(function|const\s|let\s|import\s|return\s|class\s)\b/.test(t)) return "explained";

  // Advising / steps / suggestions
  if (
    /\b(try|consider|you\s+could|one\s+option|here'?s\s+(what|how)|step\s+\d|first,?\s|start\s+(by|with))\b/.test(t) &&
    !endsWithQuestion
  ) return "advised";

  // Created something (story, poem, content)
  if (t.length > 300 && /\b(once|chapter|verse|title|scene)\b/.test(t)) return "created";

  // Reflection / observation
  if (
    !endsWithQuestion &&
    /\b(i\s+think|that'?s\s+interesting|something\s+about|it\s+feels\s+like|i\s+noticed)\b/.test(t)
  ) return "reflected";

  // Direct answer (short, declarative)
  if (!endsWithQuestion && t.length < 150) return "direct_answer";

  // Question-led (generic)
  if (endsWithQuestion && questionCount >= 1) return "asked_question";

  return "observation";
}

/**
 * Extract the first ~6 words of an assistant message as an "opening fingerprint".
 * Used to detect repeated openers.
 */
function extractOpening(text: string): string {
  return text.trim().split(/\s+/).slice(0, 6).join(" ").toLowerCase();
}

// ── Continuity Builder ─────────────────────────────────────

/**
 * Build a fresh ConversationContinuity from the current message array.
 * Called before each request to compute the latest state.
 * No mutation — returns a new object every time.
 */
export function buildContinuity(messages: Message[]): ConversationContinuity {
  // Filter to actual conversation messages (skip greeting placeholder and deleted messages)
  const convo = messages.filter(
    (m) => m.id !== "greeting" && m.content !== "(shared a photo)" && !m.imageLoading && !m.is_deleted
  );

  const userMessages = convo.filter((m) => m.role === "user");
  const assistantMessages = convo.filter((m) => m.role === "assistant");

  // Infer modes from recent user messages
  const recentUserTexts = userMessages.slice(-MAX_TRACKED_MODES);
  const recentModes = recentUserTexts.map((m) => inferUserMode(m.content));

  // Infer tone from the most recent user message
  const lastUser = userMessages[userMessages.length - 1];
  const recentTone: EmotionalTone = lastUser
    ? inferEmotionalTone(lastUser.content)
    : "neutral";

  // Classify recent assistant moves
  const recentAssistant = assistantMessages.slice(-MAX_TRACKED_MOVES);
  const recentAssistantMoves = recentAssistant.map((m) =>
    classifyAssistantMove(m.content)
  );

  // Extract recent assistant openings
  const recentAssistantOpenings = assistantMessages
    .slice(-MAX_TRACKED_OPENINGS)
    .map((m) => extractOpening(m.content));

  // Count consecutive question-led assistant turns
  let questionStreak = 0;
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const move = classifyAssistantMove(assistantMessages[i].content);
    if (move === "asked_question" || move === "emotional_checkin") {
      questionStreak++;
    } else {
      break;
    }
  }

  // Last user intent
  const lastUserIntent: InteractionMode = lastUser
    ? inferUserMode(lastUser.content)
    : "conversational";

  return {
    turnCount: userMessages.length,
    recentModes,
    recentTone,
    recentAssistantMoves,
    recentAssistantOpenings,
    questionStreak,
    lastUserIntent,
  };
}

// ── Prompt Block Builder ───────────────────────────────────

/**
 * Build a compact continuity block to inject into the system prompt.
 * Returns null for the first 1-2 turns (not enough data to be useful).
 */
export function buildContinuityBlock(
  continuity: ConversationContinuity
): string | null {
  // Don't inject continuity on the first couple of turns
  if (continuity.turnCount < 2) return null;

  const lines: string[] = [];
  lines.push("CONVERSATION CONTINUITY (current chat context):");

  // ── Turn count context ──
  lines.push(`- This is turn ${continuity.turnCount} of this conversation.`);

  // ── Mode trend ──
  const modeCounts = new Map<InteractionMode, number>();
  for (const m of continuity.recentModes) {
    modeCounts.set(m, (modeCounts.get(m) || 0) + 1);
  }
  const dominantMode = [...modeCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0];

  if (dominantMode && dominantMode !== "conversational") {
    lines.push(
      `- The user has been mostly in "${dominantMode}" mode recently. Stay in that register unless they shift.`
    );
  }

  // ── Emotional tone ──
  if (continuity.recentTone !== "neutral") {
    const toneGuidance: Record<string, string> = {
      heavy: "They seem down right now. Be there for them but don't be weird about it.",
      frustrated: "They're frustrated. Be direct and useful, skip the soft stuff.",
      uncertain: "They seem unsure about something. Be real with them, don't lecture.",
      excited: "They're hyped. Match that energy!",
      playful: "Vibe is playful. Keep it fun.",
      calm: "Chill energy. No need to amp anything up.",
    };
    const guidance = toneGuidance[continuity.recentTone];
    if (guidance) lines.push(`- ${guidance}`);
  }

  // ── Anti-repetition: assistant moves ──
  if (continuity.recentAssistantMoves.length >= 2) {
    const lastTwo = continuity.recentAssistantMoves.slice(-2);
    if (lastTwo[0] === lastTwo[1]) {
      const moveLabels: Record<AssistantMove, string> = {
        asked_question: "asking a question",
        emotional_checkin: "doing an emotional check-in",
        reflected: "reflecting/observing",
        advised: "giving advice",
        explained: "explaining",
        created: "creating content",
        comforted: "offering comfort",
        joked: "joking",
        direct_answer: "giving a direct answer",
        observation: "making an observation",
      };
      const label = moveLabels[lastTwo[0]] || lastTwo[0];
      lines.push(
        `- You've been ${label} for the last 2 turns. Break the pattern — try a different kind of response.`
      );
    }
  }

  // ── Question fatigue ──
  if (continuity.questionStreak >= 2) {
    lines.push(
      `- You've ended ${continuity.questionStreak} consecutive responses with questions. This turn, lead with a statement, thought, or observation instead. Do NOT end with a question.`
    );
  }

  // ── Opening repetition ──
  if (continuity.recentAssistantOpenings.length >= 2) {
    const openings = continuity.recentAssistantOpenings;
    // Check if recent openings share the same first word
    const firstWords = openings.map((o) => o.split(" ")[0]);
    const lastWord = firstWords[firstWords.length - 1];
    const repeatedStarts = firstWords.filter((w) => w === lastWord).length;
    if (repeatedStarts >= 2) {
      lines.push(
        `- Your last ${repeatedStarts} responses started with "${lastWord}…". Start this one differently.`
      );
    }
  }

  // ── Mode-specific guidance ──
  if (continuity.lastUserIntent === "technical") {
    lines.push(
      "- They're in problem-solving mode. Be sharp and helpful, skip the feelings."
    );
  } else if (continuity.lastUserIntent === "practical") {
    lines.push(
      "- They need practical help. Be useful first, personality second."
    );
  } else if (continuity.lastUserIntent === "creative") {
    lines.push(
      "- They're in creative mode. Riff with them, build on their ideas."
    );
  } else if (continuity.lastUserIntent === "emotional") {
    // Only add emotional guidance if we haven't been over-doing check-ins
    if (continuity.questionStreak < 2) {
      lines.push(
        "- They're opening up about something personal. Be real with them."
      );
    }
  }

  return lines.join("\n");
}
