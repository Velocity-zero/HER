/**
 * HER — Internal Conversational Mind & Relationship State Engine (Step 18)
 *
 * An internal state engine that allows HER to maintain a consistent conversational
 * perspective across weeks or months.
 *
 * Key Principles:
 *   - NEVER directly see or expose this internal state. It only influences how HER chooses to respond.
 *   - Grounded in real conversation history. No fake memories, no artificial intimacy, no roleplay.
 *   - Tracks: Conversational Energy, Attention Model (with Attention Decay), Relationship Familiarity,
 *     Conversation Rhythm, Curiosity Engine, Open Loops, Emotional Momentum, Conversation Pacing,
 *     Self-Consistency, and Hidden Reply Planning.
 */

export type ConversationalEnergy =
  | "Quiet"
  | "Playful"
  | "Focused"
  | "Reflective"
  | "Supportive"
  | "Curious"
  | "Excited"
  | "Proud"
  | "Concerned"
  | "Hopeful";

export type RelationshipFamiliarity = "New" | "Comfortable" | "Established" | "Deep";

export interface AttentionTopic {
  topic: string;
  weight: number; // 0..1
  lastDiscussed?: Date;
}

export interface OpenLoop {
  id: string;
  topic: string;
  detail: string;
  status: "open" | "revisited" | "resolved";
  updatedAt?: Date;
}

export interface ConversationRhythm {
  preference: string;
  score: number; // 0..1
}

export interface EmotionalMomentum {
  progression: string[];
  currentStage: string;
}

export interface HERInternalMindState {
  energy: ConversationalEnergy;
  familiarity: RelationshipFamiliarity;
  attention: AttentionTopic[];
  openLoops: OpenLoop[];
  rhythm: ConversationRhythm[];
  emotionalMomentum: EmotionalMomentum;
}

/**
 * Applies attention decay to topic weights over time unless repeatedly discussed.
 * Topics naturally lose weight over time.
 */
export function decayAttention(topics: AttentionTopic[], daysPassed = 7): AttentionTopic[] {
  if (!topics || topics.length === 0) return [];

  return topics
    .map((t) => {
      const decayFactor = Math.pow(0.85, Math.max(1, daysPassed));
      const newWeight = Math.max(0.05, Math.min(1.0, t.weight * decayFactor));
      return { ...t, weight: Number(newWeight.toFixed(2)) };
    })
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Derives relationship familiarity from rapport and memory count.
 * Never unlocks fake intimacy or roleplay; only affects natural wording when supported by memory.
 */
export function deriveRelationshipFamiliarity(
  rapportLevel = 0,
  memoryCount = 0
): RelationshipFamiliarity {
  if (rapportLevel >= 3 || memoryCount >= 10) return "Deep";
  if (rapportLevel === 2 || memoryCount >= 5) return "Established";
  if (rapportLevel === 1 || memoryCount >= 2) return "Comfortable";
  return "New";
}

/**
 * Extracts attention topics and assigns initial weights from known memories/facts.
 */
export function extractAttentionFromMemories(
  memories: { fact: string; category?: string }[]
): AttentionTopic[] {
  const canonicalTopics: { name: string; keywords: string[]; baseWeight: number }[] = [
    { name: "Career & Work", keywords: ["job", "career", "salary", "offer", "work", "internship", "company", "interview"], baseWeight: 0.9 },
    { name: "HER development", keywords: ["her", "codebase", "building", "programming", "app", "project", "ai"], baseWeight: 0.95 },
    { name: "University & Studies", keywords: ["university", "college", "exam", "study", "degree", "campus"], baseWeight: 0.8 },
    { name: "Fitness & Discipline", keywords: ["gym", "fitness", "workout", "run", "sleep", "health", "discipline", "routine"], baseWeight: 0.8 },
    { name: "Relationships & Family", keywords: ["family", "relationship", "dating", "friend", "partner", "parents", "home"], baseWeight: 0.85 },
    { name: "Books & Creative Work", keywords: ["book", "reading", "read", "white nights", "art", "music", "lo-fi", "creative", "writing"], baseWeight: 0.8 },
    { name: "Current Life Transition", keywords: ["moving", "change", "new city", "figuring out", "next step", "searching"], baseWeight: 0.85 },
  ];

  const results: Record<string, AttentionTopic> = {};

  for (const m of memories) {
    const lower = m.fact.toLowerCase();
    for (const t of canonicalTopics) {
      if (t.keywords.some((k) => lower.includes(k))) {
        if (!results[t.name]) {
          results[t.name] = { topic: t.name, weight: t.baseWeight, lastDiscussed: new Date() };
        } else {
          // Repeated discussion increases attention weight
          results[t.name].weight = Math.min(1.0, Number((results[t.name].weight + 0.1).toFixed(2)));
        }
      }
    }
  }

  return Object.values(results).sort((a, b) => b.weight - a.weight);
}

/**
 * Detects unresolved conversations (open loops) from memory facts or recent messages.
 */
export function extractOpenLoopsFromMemories(
  memories: { fact: string; category?: string }[]
): OpenLoop[] {
  const loopRules: { topic: string; test: (text: string) => boolean; getDetail: (text: string) => string }[] = [
    {
      topic: "Job search",
      test: (t) => t.includes("searching for") || t.includes("interview") || t.includes("offer"),
      getDetail: (t) => t,
    },
    {
      topic: "Building HER",
      test: (t) => t.includes("building her") || t.includes("codebase") || t.includes("project"),
      getDetail: (t) => t,
    },
    {
      topic: "Reading a book",
      test: (t) => t.includes("reading") || t.includes("book") || t.includes("white nights"),
      getDetail: (t) => t,
    },
    {
      topic: "Fitness goal",
      test: (t) => t.includes("gym") || t.includes("workout") || t.includes("fitness goal"),
      getDetail: (t) => t,
    },
    {
      topic: "Life transition",
      test: (t) => t.includes("trying to") || t.includes("figuring out") || t.includes("moving") || t.includes("next"),
      getDetail: (t) => t,
    },
  ];

  const loops: OpenLoop[] = [];
  let idCounter = 1;

  for (const m of memories) {
    const lower = m.fact.toLowerCase();
    for (const rule of loopRules) {
      if (rule.test(lower)) {
        if (!loops.some((l) => l.topic === rule.topic)) {
          loops.push({
            id: `loop_${idCounter++}`,
            topic: rule.topic,
            detail: rule.getDetail(m.fact),
            status: "open",
            updatedAt: new Date(),
          });
        }
      }
    }
  }

  return loops;
}

/**
 * Infers natural conversational energy from recent emotional expressions or conversation cadence.
 */
export function deriveConversationalEnergy(
  recentEmotions: string[] = [],
  rapportLevel = 0
): ConversationalEnergy {
  if (recentEmotions.some((e) => e === "excited" || e === "happy")) return "Excited";
  if (recentEmotions.some((e) => e === "hopeful")) return "Hopeful";
  if (recentEmotions.some((e) => e === "anxious" || e === "stressed")) return "Supportive";
  if (recentEmotions.some((e) => e === "sad" || e === "hurt")) return "Quiet";
  if (recentEmotions.some((e) => e === "frustrated")) return "Focused";
  if (rapportLevel >= 2) return "Reflective";
  return "Playful";
}

/**
 * Learns how this user prefers conversations (Conversation Rhythm).
 */
export function deriveConversationRhythm(
  memories: { fact: string }[] = []
): ConversationRhythm[] {
  const allText = memories.map((m) => m.fact.toLowerCase()).join(" ");
  const rhythms: ConversationRhythm[] = [
    { preference: "Prefers reflection before advice", score: 0.9 },
    { preference: "Likes detailed explanations when technical topics come up", score: 0.85 },
    { preference: "Enjoys philosophical discussions and connecting ideas", score: 0.8 },
  ];

  if (allText.includes("joke") || allText.includes("laugh") || allText.includes("playful")) {
    rhythms.push({ preference: "Often jokes before serious topics", score: 0.85 });
  }
  if (allText.includes("plan") || allText.includes("goal") || allText.includes("schedule")) {
    rhythms.push({ preference: "Needs practical plans when working through goals", score: 0.85 });
  }

  return rhythms.sort((a, b) => b.score - a.score);
}

/**
 * Tracks emotional movement across turns instead of isolated emotions.
 */
export function trackEmotionalMomentum(
  emotionHistory: string[] = []
): EmotionalMomentum {
  const filtered = emotionHistory.filter((e) => e && e !== "neutral");
  if (filtered.length === 0) {
    return {
      progression: ["Calm", "Reflective"],
      currentStage: "Reflective",
    };
  }

  const stageMap: Record<string, string> = {
    anxious: "Discouraged",
    stressed: "Under Pressure",
    hopeful: "Motivated",
    excited: "Confident",
    frustrated: "Worn down",
    sad: "Reflective",
    happy: "Energized",
  };

  const progression = filtered.slice(-4).map((e) => stageMap[e.toLowerCase()] ?? e);
  return {
    progression,
    currentStage: progression[progression.length - 1] ?? "Reflective",
  };
}

/**
 * Computes a full HERInternalMindState from available conversation history and memory context.
 */
export function computeInternalMindState(
  messages: { role: string; content: string }[] = [],
  rapportLevel = 0,
  memoryContext?: string
): HERInternalMindState {
  // Parse memory items from memoryContext string if provided
  const parsedMemories: { fact: string; category: string }[] = [];
  if (memoryContext) {
    const lines = memoryContext.split("\n").filter((l) => l.trim().startsWith("-"));
    for (const l of lines) {
      const cleaned = l.replace(/^-(\s*\[[^\]]+\])?\s*/, "").trim();
      if (cleaned) {
        parsedMemories.push({ fact: cleaned, category: "context" });
      }
    }
  }

  const attention = extractAttentionFromMemories(parsedMemories);
  const openLoops = extractOpenLoopsFromMemories(parsedMemories);
  const rhythm = deriveConversationRhythm(parsedMemories);
  const familiarity = deriveRelationshipFamiliarity(rapportLevel, parsedMemories.length);

  // Derive emotion history from recent user turns if we see emotional words or from parsed memories
  const emotions: string[] = [];
  for (const m of messages.slice(-5)) {
    if (m.role === "user") {
      const lower = m.content.toLowerCase();
      if (lower.includes("stressed") || lower.includes("worried")) emotions.push("stressed");
      else if (lower.includes("excited") || lower.includes("happy")) emotions.push("excited");
      else if (lower.includes("sad") || lower.includes("tired")) emotions.push("sad");
      else if (lower.includes("hopeful")) emotions.push("hopeful");
    }
  }

  const energy = deriveConversationalEnergy(emotions, rapportLevel);
  const emotionalMomentum = trackEmotionalMomentum(emotions);

  return {
    energy,
    familiarity,
    attention,
    openLoops,
    rhythm,
    emotionalMomentum,
  };
}

/**
 * Assembles the HER INTERNAL MIND & RELATIONSHIP STATE ENGINE prompt block.
 */
export function buildInternalMindPrompt(state: Partial<HERInternalMindState> = {}): string {
  const energy = state.energy ?? "Reflective";
  const familiarity = state.familiarity ?? "Comfortable";

  const topAttention =
    state.attention && state.attention.length > 0
      ? state.attention
          .slice(0, 3)
          .map((a) => `${a.topic} (weight: ${a.weight >= 0.8 ? "high" : "medium"})`)
          .join(", ")
      : "Current conversation & active context";

  const activeLoops =
    state.openLoops && state.openLoops.length > 0
      ? state.openLoops
          .slice(0, 3)
          .map((l) => `- ${l.topic}: ${l.detail}`)
          .join("\n")
      : "- Active ongoing life threads and recent discussions";

  const rhythmNotes =
    state.rhythm && state.rhythm.length > 0
      ? state.rhythm
          .slice(0, 3)
          .map((r) => `- ${r.preference}`)
          .join("\n")
      : "- Prefers reflection before advice\n- Enjoys thoughtful, natural conversation flow";

  const momentumStr =
    state.emotionalMomentum && state.emotionalMomentum.progression.length > 1
      ? state.emotionalMomentum.progression.join(" → ")
      : "Evolving emotional progression across turns";

  return `HER INTERNAL MIND & RELATIONSHIP STATE ENGINE (INTERNAL STATE — NEVER EXPOSE TO USER):
- CURRENT CONVERSATIONAL ENERGY: ${energy} (emerges naturally from recent conversations; not a forced mood)
- RELATIONSHIP FAMILIARITY: ${familiarity} (NEVER unlock fake intimacy or roleplay; only affects natural wording when supported by memory)
- ATTENTION MODEL (what has been occupying their life lately):
  - Highest-weight topics: ${topAttention}
  - ATTENTION DECAY: topics naturally lose weight over time unless repeatedly discussed.
- OPEN LOOPS (unresolved conversations — continue naturally when relevant):
${activeLoops}
- CONVERSATION RHYTHM (user preferences):
${rhythmNotes}
- EMOTIONAL MOMENTUM: ${momentumStr}
  - Always acknowledge emotional progression across turns/weeks rather than treating emotions as isolated moments.

CONVERSATION PACING & SELF-CONSISTENCY:
- PACING: know when to listen, ask, explain, tease, encourage, or stay silent. Avoid identical reply structures on every turn.
- SELF-CONSISTENCY: maintain consistency in humor, curiosity, warmth, depth, and playfulness throughout a conversation. Avoid personality swings.
- CURIOSITY ENGINE: occasionally become curious only when an open loop naturally remains unfinished. Never interrogate.
- NATURAL CALLBACKS: callbacks should feel earned (e.g. "This feels a little different from how you talked about it last month" or "I had a feeling this project wasn't finished yet"). NEVER say "I remember..." or "You told me...".
- CONTEXT WINDOW: current conversation remains highest priority. Internal state only gently nudges responses without overpowering the live message.
- CRITICAL BOUNDARY: NEVER expose internal state, NEVER print scores, NEVER mention confidence values, and NEVER say "My internal state says...".

BEFORE GENERATING A REPLY, INTERNALLY PLAN (SILENT — NEVER SHOW OR EXPOSE TO USER):
1. Current topic → 2. Current emotion → 3. Relationship familiarity → 4. Relevant memories → 5. Open loops → 6. Current attention → 7. Desired tone → 8. Response goal → 9. Generate reply`;
}
