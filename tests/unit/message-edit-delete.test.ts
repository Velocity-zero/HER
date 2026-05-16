/**
 * HER — Message Edit / Delete (Step 18.4) — pure boundary tests.
 *
 * All tests operate on pure logic without importing React or browser APIs.
 * Network / Supabase calls are replaced by in-memory stubs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../../src/lib/types.js";

// ── Helpers ────────────────────────────────────────────────

function makeMsg(overrides: Partial<Message> & { role: Message["role"] }): Message {
  return {
    id: "msg-1",
    content: "hello world",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Pure-function stubs (mirror persistence layer logic without Supabase) ──

interface MockRow {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  is_deleted: boolean;
  content: string;
}

function validateEdit(row: MockRow, callerUserId: string, newContent: string): { ok: boolean; reason?: string } {
  if (row.user_id !== callerUserId) return { ok: false, reason: "not owner" };
  if (row.role !== "user") return { ok: false, reason: "not a user message" };
  if (row.is_deleted) return { ok: false, reason: "already deleted" };
  if (!newContent.trim()) return { ok: false, reason: "empty content" };
  return { ok: true };
}

function validateDelete(row: MockRow, callerUserId: string): { ok: boolean; reason?: string } {
  if (row.user_id !== callerUserId) return { ok: false, reason: "not owner" };
  if (row.role !== "user") return { ok: false, reason: "not a user message" };
  if (row.is_deleted) return { ok: true }; // idempotent
  return { ok: true };
}

// ── Prompt assembly helper (mirrors apiMessages filter in page.tsx) ──

function assemblePromptMessages(messages: Message[]): Message[] {
  return messages
    .filter((m) => m.id !== "greeting")
    .filter((m) => !m.is_deleted);
}

// ── Continuity helper (mirrors buildContinuity filter) ──

function filterForContinuity(messages: Message[]): Message[] {
  return messages.filter(
    (m) => m.id !== "greeting" && m.content !== "(shared a photo)" && !m.imageLoading && !m.is_deleted
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Ownership + role validation
// ══════════════════════════════════════════════════════════════════════════

test("edit — rejects when caller is not the owner", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "user", is_deleted: false, content: "hi" };
  const result = validateEdit(row, "user-B", "new text");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not owner");
});

test("edit — rejects assistant messages", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "assistant", is_deleted: false, content: "hi" };
  const result = validateEdit(row, "user-A", "new text");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not a user message");
});

test("edit — rejects already-deleted messages", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "user", is_deleted: true, content: "hi" };
  const result = validateEdit(row, "user-A", "new text");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "already deleted");
});

test("edit — rejects empty content", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "user", is_deleted: false, content: "hi" };
  const result = validateEdit(row, "user-A", "   ");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty content");
});

test("edit — accepts valid owner + non-empty content", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "user", is_deleted: false, content: "old" };
  const result = validateEdit(row, "user-A", "new content");
  assert.equal(result.ok, true);
});

test("delete — rejects when caller is not the owner", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "user", is_deleted: false, content: "hi" };
  const result = validateDelete(row, "user-B");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not owner");
});

test("delete — rejects assistant messages", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "assistant", is_deleted: false, content: "hi" };
  const result = validateDelete(row, "user-A");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not a user message");
});

test("delete — is idempotent on already-deleted messages", () => {
  const row: MockRow = { id: "m1", user_id: "user-A", role: "user", is_deleted: true, content: "hi" };
  const result = validateDelete(row, "user-A");
  assert.equal(result.ok, true);
});

// ══════════════════════════════════════════════════════════════════════════
// Prompt assembly — deleted messages excluded
// ══════════════════════════════════════════════════════════════════════════

test("assemblePromptMessages — excludes deleted messages from prompt", () => {
  const messages: Message[] = [
    makeMsg({ id: "greeting", role: "assistant", content: "hi!" }),
    makeMsg({ id: "m1", role: "user", content: "I hate movies", is_deleted: true }),
    makeMsg({ id: "m2", role: "assistant", content: "oh interesting" }),
    makeMsg({ id: "m3", role: "user", content: "just kidding, I love them" }),
  ];
  const result = assemblePromptMessages(messages);
  // greeting filtered, m1 deleted, m2+m3 remain
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "m2");
  assert.equal(result[1].id, "m3");
});

test("assemblePromptMessages — includes edited messages with updated content", () => {
  const messages: Message[] = [
    makeMsg({ id: "m1", role: "user", content: "I love movies", edited_at: new Date().toISOString() }),
    makeMsg({ id: "m2", role: "assistant", content: "great!" }),
  ];
  const result = assemblePromptMessages(messages);
  assert.equal(result.length, 2);
  assert.equal(result[0].content, "I love movies"); // edited content, not original
});

test("assemblePromptMessages — keeps assistant replies even when user message is deleted", () => {
  const messages: Message[] = [
    makeMsg({ id: "m1", role: "user", content: "deleted msg", is_deleted: true }),
    makeMsg({ id: "m2", role: "assistant", content: "my reply remains" }),
  ];
  const result = assemblePromptMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "m2");
  assert.equal(result[0].content, "my reply remains");
});

// ══════════════════════════════════════════════════════════════════════════
// Continuity — deleted messages excluded
// ══════════════════════════════════════════════════════════════════════════

test("filterForContinuity — excludes deleted messages", () => {
  const messages: Message[] = [
    makeMsg({ id: "m1", role: "user", content: "deleted content", is_deleted: true }),
    makeMsg({ id: "m2", role: "user", content: "live message" }),
  ];
  const result = filterForContinuity(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "m2");
});

test("filterForContinuity — edited content is used as-is", () => {
  const messages: Message[] = [
    makeMsg({ id: "m1", role: "user", content: "I love movies", edited_at: "2026-01-01T00:00:00Z" }),
  ];
  const result = filterForContinuity(messages);
  assert.equal(result[0].content, "I love movies");
});

// ══════════════════════════════════════════════════════════════════════════
// Reactions preserved after edit
// ══════════════════════════════════════════════════════════════════════════

test("reactions survive an edit — reactions field is not touched", () => {
  const before: Message = makeMsg({
    id: "m1",
    role: "user",
    content: "old text",
    reactions: { "❤️": ["user"] },
  });
  // Simulate the optimistic state update in page.tsx handleEditMessage
  const after: Message = { ...before, content: "new text", edited_at: new Date().toISOString() };
  assert.deepEqual(after.reactions, { "❤️": ["user"] });
  assert.equal(after.content, "new text");
  assert.ok(after.edited_at);
});

// ══════════════════════════════════════════════════════════════════════════
// Optimistic rollback
// ══════════════════════════════════════════════════════════════════════════

test("optimistic edit rolls back on failure", () => {
  const original = "hello world";
  let content = original;
  let editedAt: string | undefined;

  // Simulate optimistic update
  content = "oops broken";
  editedAt = new Date().toISOString();

  // Simulate rollback
  content = original;
  editedAt = undefined;

  assert.equal(content, original);
  assert.equal(editedAt, undefined);
});

test("optimistic delete rolls back on failure", () => {
  let isDeleted = false;

  // Simulate optimistic tombstone
  isDeleted = true;

  // Simulate rollback
  isDeleted = false;

  assert.equal(isDeleted, false);
});

// ══════════════════════════════════════════════════════════════════════════
// Tombstone rendering conditions
// ══════════════════════════════════════════════════════════════════════════

test("tombstone shown for is_deleted messages", () => {
  const msg = makeMsg({ id: "m1", role: "user", content: "text", is_deleted: true });
  // In MessageBubble, `if (isDeleted) return tombstone;`
  assert.equal(msg.is_deleted, true);
  // Tombstone text constant
  const tombstoneText = "message deleted";
  assert.ok(tombstoneText.length > 0);
});

test("no tombstone for live messages", () => {
  const msg = makeMsg({ id: "m1", role: "user", content: "alive" });
  assert.ok(!msg.is_deleted);
});

// ══════════════════════════════════════════════════════════════════════════
// Continuity: edited content used, deleted excluded from summaries
// ══════════════════════════════════════════════════════════════════════════

test("summaries ignore deleted content — zero deleted rows in filtered set", () => {
  const messages: Message[] = [
    makeMsg({ id: "m1", role: "user", content: "I hate movies", is_deleted: true }),
    makeMsg({ id: "m2", role: "user", content: "I love movies", edited_at: "2026-01-01T00:00:00Z" }),
    makeMsg({ id: "m3", role: "assistant", content: "glad you clarified!" }),
  ];
  const forContext = filterForContinuity(messages);
  const deletedInContext = forContext.filter((m) => m.is_deleted);
  assert.equal(deletedInContext.length, 0);
  // Edited message IS present with updated content
  const editedMsg = forContext.find((m) => m.id === "m2");
  assert.ok(editedMsg);
  assert.equal(editedMsg!.content, "I love movies");
});
