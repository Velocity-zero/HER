import { NextRequest, NextResponse } from "next/server";
import { ChatRequest, ChatResponse } from "@/lib/types";
import { buildPayload } from "@/lib/conversation";
import { generateReply, generateStreamReply } from "@/lib/provider";

/**
 * POST /api/chat
 *
 * Receives conversation messages from the client,
 * builds the full model payload (system prompt + history),
 * calls the configured AI provider, and returns HER's reply.
 *
 * Supports two modes:
 *   - Default: returns { message: string } JSON
 *   - Streaming (?stream=true): returns a text/plain ReadableStream
 *
 * Provider logic is fully isolated in lib/provider.ts.
 */

// ── Error classification helper ──

function classifyError(errorMessage: string): { userError: string; status: number } {
  const isConfigError =
    errorMessage.includes("not configured") ||
    errorMessage.includes("Unknown provider");

  const isRateLimit =
    errorMessage.includes("429") ||
    errorMessage.includes("quota") ||
    errorMessage.includes("Too Many Requests");

  if (isConfigError) {
    return { userError: errorMessage, status: 500 };
  } else if (isRateLimit) {
    return {
      userError: "okay hold on, too many messages at once — try again in like 30 seconds.",
      status: 429,
    };
  } else {
    return {
      userError: "wait something broke on my end — try that again?",
      status: 502,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const wantsStream = req.nextUrl.searchParams.get("stream") === "true";

    // Validate request
    if (!body.messages || !Array.isArray(body.messages)) {
      if (wantsStream) {
        return new Response("Invalid request: messages array required", { status: 400 });
      }
      return NextResponse.json(
        { message: "", error: "Invalid request: messages array required" } as ChatResponse,
        { status: 400 }
      );
    }

    if (body.messages.length === 0) {
      if (wantsStream) {
        return new Response("No messages provided", { status: 400 });
      }
      return NextResponse.json(
        { message: "", error: "No messages provided" } as ChatResponse,
        { status: 400 }
      );
    }

    // Build the full model payload
    const payload = buildPayload(body.messages, {
      mode: body.mode || "default",
      continuityContext: body.continuityContext,
      rapportLevel: body.rapportLevel,
    });

    console.log(
      `[HER API] ${body.messages.length} messages → ${payload.length} payload items (mode: ${body.mode || "default"}, rapport: ${body.rapportLevel ?? 0}, stream: ${wantsStream})`
    );

    // ── Streaming path ──
    if (wantsStream) {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const chunk of generateStreamReply(payload)) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Stream failed";
            console.error("[HER API] Stream error:", msg);
            controller.error(err);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    // ── Non-streaming path (backward compatible) ──
    const reply = await generateReply(payload);

    return NextResponse.json({
      message: reply,
    } as ChatResponse);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Something went wrong";

    console.error("[HER API] Error:", errorMessage);

    const { userError, status } = classifyError(errorMessage);

    // For stream requests, return plain text error
    const wantsStream = req.nextUrl.searchParams.get("stream") === "true";
    if (wantsStream) {
      return new Response(userError, { status });
    }

    return NextResponse.json(
      { message: "", error: userError } as ChatResponse,
      { status }
    );
  }
}
