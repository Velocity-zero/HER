/**
 * HER — Integrity Repair Dispatcher (Step 18.5)
 *
 * Applies `RepairAction`s under explicit safety rules:
 *   • Never apply repairs for `critical` severity — those are log-only.
 *   • Cap repairs per user per tick (`INTEGRITY_LIMITS.repairsPerUser`).
 *   • Stop early if too many consecutive repairs fail (runaway protection).
 *   • Every applied repair logs a structured REPAIRED line with before/after.
 *
 * Pure-ish: side effects are confined to the `apply` callbacks the rules
 * provided, and to console.* via the logger.
 */

import { logFailed, logRepaired, logSkipped } from "./logger";
import { INTEGRITY_LIMITS } from "./types";
import type {
  IntegrityFinding,
  RepairAction,
  RepairReport,
  RuleResult,
} from "./types";

const FAILURE_HALT_THRESHOLD = 3;

export interface DispatchInput {
  userId: string;
  rulesRun: RuleResult[];
  /** Repairs collected from rules, in the order they were emitted. */
  repairs: RepairAction[];
}

export interface DispatchOutput {
  applied: RepairReport[];
  skipped: RepairReport[];
  haltedEarly: boolean;
}

/**
 * Apply the repairs. Caller passes the findings list so we can suppress
 * any repair whose rule produced a critical-severity finding (defence in
 * depth — rules shouldn't emit repairs for critical, but if they do, we
 * still refuse to run them here).
 */
export async function dispatchRepairs(
  input: DispatchInput,
): Promise<DispatchOutput> {
  const findingsByRule = new Map<string, IntegrityFinding[]>();
  for (const r of input.rulesRun) {
    findingsByRule.set(r.rule, r.findings);
  }

  const applied: RepairReport[] = [];
  const skipped: RepairReport[] = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < input.repairs.length; i++) {
    if (applied.length + skipped.length >= INTEGRITY_LIMITS.repairsPerUser) {
      logSkipped(input.userId, null, "repairs_per_user_cap_reached");
      return { applied, skipped, haltedEarly: true };
    }
    if (consecutiveFailures >= FAILURE_HALT_THRESHOLD) {
      logSkipped(input.userId, null, "repair_failure_threshold_hit");
      return { applied, skipped, haltedEarly: true };
    }

    const action = input.repairs[i];
    const ruleFindings = findingsByRule.get(action.rule) ?? [];
    const hasCritical = ruleFindings.some((f) => f.severity === "critical");
    if (hasCritical) {
      const report: RepairReport = {
        rule: action.rule,
        applied: false,
        reason: "skipped_critical_severity",
        durationMs: 0,
        before: action.before,
        after: action.after,
      };
      skipped.push(report);
      logSkipped(input.userId, action.rule, "skipped_critical_severity");
      continue;
    }

    const t0 = Date.now();
    let success = false;
    try {
      success = await action.apply();
    } catch (err) {
      logFailed(input.userId, action.rule, err);
      success = false;
    }
    const durationMs = Date.now() - t0;

    const report: RepairReport = {
      rule: action.rule,
      applied: success,
      reason: success ? action.description : "apply_returned_false_or_threw",
      durationMs,
      before: action.before,
      after: action.after,
    };

    if (success) {
      applied.push(report);
      logRepaired(input.userId, report);
      consecutiveFailures = 0;
    } else {
      skipped.push(report);
      consecutiveFailures++;
    }
  }

  return { applied, skipped, haltedEarly: false };
}
