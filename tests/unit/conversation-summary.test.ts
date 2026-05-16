/**
 * HER — Step 18.3 (Phase C) conversation summarizer tests.
 *
 * The summarizer is heuristic and deterministic — same input must give
 * the same output, every time, with no I/O.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildConversationSummary, CONTEXT_CONFIG } from "../../src/lib/context.js";
import type { Message } from "../../src/lib/types.js";

const mkMsg = (role: "user" | "assistant", content: string, i = 0): Message => ({
  id: `m${i}`,
  role,
  content,
  timestamp: Date.UTC(2024, 0, 1, 12, i),
});

test("summary — returns null for very short older windows", () => {
  assert.equal(buildConversationSummary([]), null);
  assert.equal(buildConversationSummary([mkMsg("user", "hi")]), null);
  assert.equal(
    buildConversationSummary([
      mkMsg("user", "hi", 1),
      mkMsg("assistant", "hey", 2),
      mkMsg("user", "how are you", 3),
    ]),
    null,
  );
});

test("summary — produces a compact, bounded string for longer windows", () => {
  const older: Message[] = [];
  for (let i = 0; i < 20; i++) {
    older.push(mkMsg(i % 2 === 0 ? "user" : "assistant", `message number ${i}`, i));
  }
  const summary = buildConversationSummary(older);
  assert.ok(summary, "expected a summary for 20-turn older window");
  assert.ok(summary!.length < 1500, "summary must stay bounded");
  assert.ok(summary!.includes("20 earlier turns"), "must mention turn count");
});

test("summary — deterministic for identical input", () => {
  const older: Message[] = [];
  for (let i = 0; i < 10; i++) {
    older.push(mkMsg(i % 2 === 0 ? "user" : "assistant", `line ${i}`, i));
  }
  const a = buildConversationSummary(older);
  const b = buildConversationSummary(older);
  assert.equal(a, b);
});

test("summary — truncates very long messages with an ellipsis", () => {
  const longText = "really long message ".repeat(50);
  const older: Message[] = [
    mkMsg("user", longText, 1),
    mkMsg("assistant", "a", 2),
    mkMsg("user", "b", 3),
    mkMsg("assistant", "c", 4),
  ];
  const summary = buildConversationSummary(older);
  assert.ok(summary);
  assert.ok(summary!.includes("…"), "long quoted content should be truncated");
});

test("CONTEXT_CONFIG.recentMessageCount tightened to 30 (Phase C)", () => {
  assert.equal(CONTEXT_CONFIG.recentMessageCount, 30);
});
