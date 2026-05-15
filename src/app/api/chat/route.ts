import { NextRequest, NextResponse } from "next/server";
import { ChatRequest, ChatResponse } from "@/lib/types";
import { buildPayload } from "@/lib/conversation";
import { generateReply, generateStreamReply } from "@/lib/provider";
import { validateApiRequest, checkBodySize, MAX_MESSAGES_COUNT, MAX_MESSAGE_LENGTH } from "@/lib/api-auth";
import { debug } from "@/lib/debug";
import { createTrace } from "@/lib/trace";
import { auditContext, reportToLog } from "@/lib/context-budget";
import { auditContextPayloads } from "@/lib/recursive-context-detector";
import { classifyFailure } from "@/lib/failure-classify";

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
//
// Step 18.2: Classification logic now lives in `lib/failure-classify.ts` so
// every entry point (chat, cron, signals, image) can attribute failures with
// the same `HER_*` codes. This wrapper preserves the historical
// `{ userError, status }` shape used throughout this file.

function classifyError(errorMessage: string): { userError: string; status: number; code: string } {
  // Preserve the legacy "config error returns its own message" behavior so
  // missing-API-key warnings still surface verbatim during local setup.
  if (errorMessage.includes("not configured") || errorMessage.includes("Unknown provider")) {
    return { userError: errorMessage, status: 500, code: "HER_PROVIDER_ERROR" };
  }
  const c = classifyFailure(new Error(errorMessage));
  return { userError: c.userMessage, status: c.status, code: c.code };
}

export async function POST(req: NextRequest) {
  // Step 18.2: every request gets a short trace id and stage timeline so
  // we can attribute slow / failing requests to a specific subsystem.
  const trace = createTrace();
  const wantsStream = req.nextUrl.searchParams.get("stream") === "true";

  try {
    trace.stage("request_start", { stream: wantsStream });

    // ── Auth check ──
    const auth = await validateApiRequest(req);
    if (auth.error) {
      trace.stage("auth_blocked");
      return auth.error;
    }
    trace.stage("auth_ok", { userId: auth.userId === "guest" ? "guest" : "user" });

    // ── Body size check ──
    const sizeError = checkBodySize(req);
    if (sizeError) {
      trace.stage("body_size_blocked");
      return sizeError;
    }

    const body: ChatRequest = await req.json();
    trace.stage("body_parsed", { msgCount: body.messages?.length ?? 0 });

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

    // Enforce limits: max message count + truncate long content
    if (body.messages.length > MAX_MESSAGES_COUNT) {
      body.messages = body.messages.slice(-MAX_MESSAGES_COUNT);
    }
    for (const msg of body.messages) {
      if (msg.content && msg.content.length > MAX_MESSAGE_LENGTH) {
        msg.content = msg.content.slice(0, MAX_MESSAGE_LENGTH);
      }
    }

    // ── Step 18.2: Recursion audit on incoming context payloads ──
    // We scan whatever the client sent us BEFORE we feed it into the
    // prompt. Any hits mean a previous prompt assembly leaked into a
    // stored field — log loudly so we can find the source. We do not
    // strip; that's a Phase B decision once we know which surface leaks.
    const recursionFindings = auditContextPayloads({
      memoryContext: body.memoryContext,
      continuityContext: body.continuityContext,
      responseModeInstruction: body.responseModeInstruction,
      antiRepetitionInstruction: body.antiRepetitionInstruction,
    });
    if (recursionFindings.length > 0) {
      console.warn("[HER Recursion] possible recursive context detected", {
        traceId: trace.traceId,
        findings: recursionFindings,
      });
    }

    // Build the full model payload
    trace.stage("prompt_assembly_start");
    const payload = buildPayload(body.messages, {
      mode: body.mode || "default",
      continuityContext: body.continuityContext,
      rapportLevel: body.rapportLevel,
      memoryContext: body.memoryContext,
      responseModeInstruction: body.responseModeInstruction,
      antiRepetitionInstruction: body.antiRepetitionInstruction,
      userTimezone: body.userTimezone,
    });
    trace.stage("prompt_assembly_end", { payloadMessages: payload.length });

    // ── Step 18.2: Prompt size + token audit ──
    // payload[0] is always the assembled system prompt (see context.ts);
    // the rest is the message window. We measure both separately so the
    // log line shows where bloat is actually coming from.
    const systemPromptText = payload[0]?.content ?? "";
    const historyText = payload.slice(1).map((m) => m.content).join("\n");
    const audit = auditContext({
      systemPrompt: systemPromptText,
      historyText,
      memoryContext: body.memoryContext,
      continuityContext: body.continuityContext,
      // Interaction signals + self-state brief are already embedded inside
      // continuityContext on the way in — we don't double-count.
    });
    console.log("[HER Context]", {
      traceId: trace.traceId,
      ...reportToLog(audit),
    });

    debug(
      `[HER API] ${body.messages.length} msgs → ${payload.length} payload (stream: ${wantsStream})`
    );

    // ── Streaming path ──
    if (wantsStream) {
      trace.stage("llm_stream_start");
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let chunksEmitted = 0;
          try {
            for await (const chunk of generateStreamReply(payload)) {
              controller.enqueue(encoder.encode(chunk));
              chunksEmitted++;
            }
            controller.close();
            trace.stage("llm_stream_end", { chunks: chunksEmitted });
            trace.end({ outcome: "stream_ok", chunks: chunksEmitted });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Stream failed";
            const cls = classifyFailure(err);
            console.error("[HER API] Stream error:", {
              traceId: trace.traceId,
              code: cls.code,
              reason: cls.internalReason,
            });
            trace.stage("llm_stream_error", { code: cls.code, chunksBeforeError: chunksEmitted });
            trace.end({ outcome: "stream_error", code: cls.code });
            // If no chunks were emitted, close cleanly so the client gets a proper error
            // If chunks were already sent, error the stream to signal failure
            if (chunksEmitted === 0) {
              controller.close();
            } else {
              controller.error(err);
            }
            void msg;
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
    trace.stage("llm_request_start");
    const reply = await generateReply(payload);
    trace.stage("llm_request_end", { replyChars: reply.length });
    trace.end({ outcome: "ok", replyChars: reply.length });

    return NextResponse.json({
      message: reply,
    } as ChatResponse);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Something went wrong";

    const { userError, status, code } = classifyError(errorMessage);

    console.error("[HER API] Error:", {
      traceId: trace.traceId,
      code,
      reason: errorMessage,
    });
    trace.end({ outcome: "error", code });

    // For stream requests, return plain text error
    if (wantsStream) {
      return new Response(userError, { status });
    }

    return NextResponse.json(
      { message: "", error: userError } as ChatResponse,
      { status }
    );
  }
}
