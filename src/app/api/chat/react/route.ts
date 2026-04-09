import { NextRequest, NextResponse } from "next/server";
import { NVIDIA_CHAT_URL, NVIDIA_CHAT_MODEL } from "@/lib/provider";
import { validateApiRequest, checkBodySize } from "@/lib/api-auth";

/**
 * POST /api/chat/react
 *
 * Lightweight endpoint: given a user message and HER's reply,
 * returns a single emoji that HER would react with — or "none".
 *
 * Uses minimal tokens (tiny prompt, max_tokens=4) to keep it fast and cheap.
 */

const REACT_SYSTEM_PROMPT = `You are deciding whether to react to a message with a single emoji.
You're a young woman texting your close friend. You just replied to their message.
Now decide: do you want to tap a reaction emoji on their message?

Rules:
- If the message genuinely makes you feel something (funny, sweet, exciting, sad, impressive), respond with exactly ONE emoji.
- If it's just a normal conversational message, respond with exactly the word "none".
- Pick from common reaction emoji: ❤️ 😂 😮 😢 🔥 😘 🥰 😚 🤩 🙄 😴 🥱 🤐 🤣 🤯 😱 🥳 😇 🤧 😡 🤬 🤒 🤕 🤭 👏 😍 🥺 💀 😭 🙄 👀 💕 ✨ 🫶
- Respond with ONLY the emoji or "none". Nothing else. No explanation.`;

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ──
    const auth = await validateApiRequest(req);
    if (auth.error) return auth.error;

    const sizeError = checkBodySize(req);
    if (sizeError) return sizeError;

    const { userMessage, herReply } = await req.json();

    if (!userMessage || !herReply) {
      return NextResponse.json({ emoji: null }, { status: 400 });
    }

    const apiKey = process.env.NVIDIA_CHAT_API_KEY;
    if (!apiKey || apiKey === "your_chat_key_here") {
      return NextResponse.json({ emoji: null });
    }

    const res = await fetch(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_CHAT_MODEL,
        messages: [
          { role: "system", content: REACT_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
          { role: "assistant", content: herReply },
          { role: "user", content: "Do you want to react to their message with an emoji?" },
        ],
        max_tokens: 4,
        temperature: 0.9,
        stream: false,
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ emoji: null });
    }

    const data = await res.json();
    const raw = (data?.choices?.[0]?.message?.content ?? "").trim();

    // Validate: must be a single emoji, not "none"
    if (!raw || raw.toLowerCase() === "none" || raw.length > 8) {
      return NextResponse.json({ emoji: null });
    }

    // Check it's actually emoji-like (not random text)
    const EMOJI_RE = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F|\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}))*$/u;
    if (!EMOJI_RE.test(raw)) {
      return NextResponse.json({ emoji: null });
    }

    return NextResponse.json({ emoji: raw });
  } catch {
    return NextResponse.json({ emoji: null });
  }
}
