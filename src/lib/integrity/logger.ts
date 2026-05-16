/**
 * HER — Integrity Logger (Step 18.5)
 *
 * Structured logs with a single shape so we can grep across runs:
 *   [HER Integrity] AUDIT          { userId, ranAt }
 *   [HER Integrity] DRIFT DETECTED { userId, rule, severity, metadata }
 *   [HER Integrity] REPAIRED       { userId, rule, before, after, durationMs }
 *   [HER Integrity] SKIPPED        { userId, reason }
 *   [HER Integrity] FAILED         { userId, rule, error }
 *
 * Never throws. Always returns void.
 */

import type {
  IntegrityFinding,
  RepairReport,
  RuleId,
  Severity,
} from "./types";

const PREFIX = "[HER Integrity]";

export function logAuditStart(userId: string, ranAt: string): void {
  console.log(PREFIX, "AUDIT", { userId, ranAt });
}

export function logDrift(
  userId: string,
  conversationId: string | null,
  finding: IntegrityFinding,
): void {
  if (!finding.detected) return;
  console.warn(PREFIX, "DRIFT DETECTED", {
    userId,
    conversationId,
    rule: finding.rule,
    severity: finding.severity,
    repairable: finding.repairable,
    metadata: finding.metadata,
  });
}

export function logRepaired(userId: string, report: RepairReport): void {
  console.log(PREFIX, "REPAIRED", {
    userId,
    rule: report.rule,
    reason: report.reason,
    before: report.before,
    after: report.after,
    durationMs: report.durationMs,
  });
}

export function logSkipped(
  userId: string,
  rule: RuleId | null,
  reason: string,
): void {
  console.log(PREFIX, "SKIPPED", { userId, rule, reason });
}

export function logFailed(
  userId: string,
  rule: RuleId | null,
  err: unknown,
): void {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown";
  console.error(PREFIX, "FAILED", { userId, rule, error: message });
}

export function logCritical(
  userId: string,
  rule: RuleId,
  severity: Severity,
  metadata: Record<string, unknown>,
): void {
  // Critical findings are NEVER auto-repaired — they are surfaced loudly
  // so a human can decide. This is the only place we use ERROR level for a
  // detection rather than a failure.
  console.error(PREFIX, "CRITICAL", {
    userId,
    rule,
    severity,
    metadata,
    note: "auto-repair disabled for critical severity",
  });
}
