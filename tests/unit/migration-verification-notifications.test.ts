import test from "node:test";
import assert from "node:assert/strict";
import { NVIDIA_CHAT_MODEL, DEFAULT_NVIDIA_CHAT_MODEL } from "../../src/lib/providers/NvidiaProvider";
import { hasTemporalSignal } from "../../src/lib/temporal";
import { getRandomFallback } from "../../src/lib/notification-messages";

test("Step 4: Proactive Notification & Temporal Scheduling Audit — Confirms Model Harmony", () => {
  // 1. Verify model string parity
  assert.equal(NVIDIA_CHAT_MODEL, DEFAULT_NVIDIA_CHAT_MODEL);

  // 2. Test temporal signal detection on proactive reminders
  assert.equal(hasTemporalSignal("remind me in 10 minutes to check the oven"), true);
  assert.equal(hasTemporalSignal("check in on me tomorrow morning before my meeting"), true);
  assert.equal(hasTemporalSignal("I have an interview next Friday at 3 PM"), true);
  assert.equal(hasTemporalSignal("I really love eating pizza with friends"), false);

  // 3. Test notification fallback pool quality and formatting
  const fallback = getRandomFallback("followup");
  assert.ok(fallback.length > 5);
  assert.equal(fallback.startsWith("Reminder:"), false);
  assert.equal(fallback.startsWith("Hey, just reminding you"), false);
});
