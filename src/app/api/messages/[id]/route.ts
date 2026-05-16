import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/api-auth";
import { editMessage, softDeleteMessage } from "@/lib/supabase-persistence";

/**
 * PATCH /api/messages/[id]
 * Edit a user message's content.
 *
 * Body: { content: string }
 *
 * Rules:
 *  - authenticated owner only
 *  - role = 'user' only (assistant / system messages are immutable)
 *  - content must be non-empty after trim
 *  - already-deleted messages are rejected
 *
 * The `id` in the URL can be either:
 *   - the Supabase UUID (for DB-loaded messages)
 *   - the client-generated message id (for messages sent in the current session)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiRequest(req);
  if (auth.error) return auth.error;

  const { id: messageId } = await params;
  if (!messageId) {
    return NextResponse.json({ error: "missing message id" }, { status: 400 });
  }

  let body: { content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content must not be empty" }, { status: 400 });
  }
  if (content.length > 10_000) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  const result = await editMessage(messageId, auth.userId, content);

  if (!result.ok) {
    const status = result.reason === "not owner" ? 403
                 : result.reason === "not found"  ? 404
                 : result.reason === "not a user message" ? 403
                 : result.reason === "already deleted" ? 409
                 : result.reason === "empty content" ? 400
                 : 500;
    console.warn(`[HER Message] EDIT REJECTED — id=${messageId} userId=${auth.userId} reason=${result.reason}`);
    return NextResponse.json({ error: result.reason }, { status });
  }

  console.log(`[HER Message] EDITED — id=${messageId} userId=${auth.userId} newLen=${content.length}`);
  return NextResponse.json({ ok: true, edited_at: new Date().toISOString() });
}

/**
 * DELETE /api/messages/[id]
 * Soft-delete a user message.
 *
 * Sets is_deleted=true, deleted_at=now. The row is kept so reactions,
 * reply anchors, and conversation structure stay intact. The UI will
 * replace the bubble with a tombstone and future prompts exclude it.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiRequest(req);
  if (auth.error) return auth.error;

  const { id: messageId } = await params;
  if (!messageId) {
    return NextResponse.json({ error: "missing message id" }, { status: 400 });
  }

  const result = await softDeleteMessage(messageId, auth.userId);

  if (!result.ok) {
    const status = result.reason === "not owner" ? 403
                 : result.reason === "not found"  ? 404
                 : result.reason === "not a user message" ? 403
                 : 500;
    console.warn(`[HER Message] DELETE REJECTED — id=${messageId} userId=${auth.userId} reason=${result.reason}`);
    return NextResponse.json({ error: result.reason }, { status });
  }

  console.log(`[HER Message] DELETED — id=${messageId} userId=${auth.userId}`);
  return NextResponse.json({ ok: true });
}
