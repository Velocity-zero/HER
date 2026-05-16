/**
 * HER — Integrity Audit Orchestrator (Step 18.5)
 *
 * Per-user audit pass:
 *   1. Safety gates — skip if the user is active, was audited recently,
 *      or currently streaming.
 *   2. Run all rules in parallel via their isolated audit functions.
 *   3. Hand collected repairs to the dispatcher.
 *   4. Roll up a `UserAuditReport` and update integrity_state.
 *
 * The orchestrator does NOT itself talk to Supabase — it accepts a
 * factory that returns a `RuleContext` for the user, plus optional
 * hooks (`isActiveNow`, `lastAuditAt`, `recordAuditState`). That keeps
 * this file unit-testable and lets the cron route inject the real DB
 * implementations.
 */

import { dispatchRepairs } from "./repair";
import { ALL_RULES, type RuleContext } from "./rules";
import { logAuditStart, logCritical, logSkipped } from "./logger";
import {
  INTEGRITY_LIMITS,
  SEVERITY_WEIGHT,
  type IntegrityFinding,
  type RepairAction,
  type RuleResult,
  type UserAuditReport,
} from "./types";

export interface OrchestratorHooks {
  /** True if the user is currently in an active session (chat open, recent activity). */
  isActiveNow(userId: string): Promise<boolean>;
  /** ISO of the last integrity check for the user. */
  lastAuditAt(userId: string): Promise<string | null>;
  /** Persist the rolled-up report. Optional — silent fallback if missing. */
  recordAuditState?(report: UserAuditReport): Promise<void>;
}

export async function auditUser(
  userId: string,
  buildContext: (userId: string) => RuleContext,
  hooks: OrchestratorHooks,
): Promise<UserAuditReport> {
  const ranAt = new Date().toISOString();
  const t0 = Date.now();
  logAuditStart(userId, ranAt);

  // ── Safety gate 1: was this user audited recently? ──
  try {
    const last = await hooks.lastAuditAt(userId);
    if (last) {
      const hoursSince = (Date.now() - new Date(last).getTime()) / 3_600_000;
      if (hoursSince < INTEGRITY_LIMITS.recentAuditSkipHours) {
        logSkipped(userId, null, `recent_audit_${hoursSince.toFixed(1)}h`);
        return {
          userId,
          ranAt,
          skipped: true,
          skipReason: "recent_audit",
          rulesRun: [],
          repairs: [],
          totalDurationMs: Date.now() - t0,
        };
      }
    }
  } catch {
    // If the bookkeeping read fails, proceed — the audit is the safe default.
  }

  // ── Safety gate 2: is the user active right now? ──
  try {
    if (await hooks.isActiveNow(userId)) {
      logSkipped(userId, null, "user_active");
      return {
        userId,
        ranAt,
        skipped: true,
        skipReason: "user_active",
        rulesRun: [],
        repairs: [],
        totalDurationMs: Date.now() - t0,
      };
    }
  } catch {
    // Same defensive stance — if we can't tell, skip to be safe.
    logSkipped(userId, null, "active_check_failed_skipping");
    return {
      userId,
      ranAt,
      skipped: true,
      skipReason: "active_check_failed",
      rulesRun: [],
      repairs: [],
      totalDurationMs: Date.now() - t0,
    };
  }

  // ── Run all rules in parallel ──
  const ctx = buildContext(userId);
  const ruleOutcomes = await Promise.all(ALL_RULES.map((r) => r(ctx)));

  const rulesRun: RuleResult[] = ruleOutcomes.map((o) => o.result);
  const repairs: RepairAction[] = ruleOutcomes.flatMap((o) => o.repairs);

  // ── Surface any critical findings loudly. NEVER auto-repair them. ──
  for (const r of rulesRun) {
    for (const f of r.findings) {
      if (f.severity === "critical" && f.detected) {
        logCritical(userId, f.rule, f.severity, f.metadata);
      }
    }
  }

  // ── Hand collected repairs to the dispatcher ──
  const dispatch = await dispatchRepairs({ userId, rulesRun, repairs });

  // ── Roll up report ──
  const report: UserAuditReport = {
    userId,
    ranAt,
    skipped: false,
    rulesRun,
    repairs: [...dispatch.applied, ...dispatch.skipped],
    totalDurationMs: Date.now() - t0,
  };

  // Persist bookkeeping if available; never let bookkeeping fail the audit.
  if (hooks.recordAuditState) {
    try {
      await hooks.recordAuditState(report);
    } catch {
      // Silent — bookkeeping is best-effort.
    }
  }

  return report;
}

/** Roll up an integrity score in [0,1] from rule findings. 1.0 = clean. */
export function scoreFromFindings(findings: IntegrityFinding[]): number {
  if (findings.length === 0) return 1.0;
  const totalWeight = findings
    .filter((f) => f.detected)
    .reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  // 10 weight points ≈ score 0. Saturate gracefully.
  return Math.max(0, Math.min(1, 1 - totalWeight / 10));
}
