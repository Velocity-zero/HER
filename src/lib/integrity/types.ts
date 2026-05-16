/**
 * HER — Integrity & Self-Healing Reconciliation (Step 18.5)
 *
 * Shared types. Everything here is pure data — no I/O.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type RuleId =
  | "deleted_message_leakage"        // A
  | "conversation_pointer_drift"     // B
  | "orphaned_events"                // C
  | "broken_reactions"               // D
  | "summary_drift"                  // E
  | "signal_drift"                   // F
  | "notification_drift";            // G

export interface IntegrityFinding {
  rule: RuleId;
  severity: Severity;
  detected: boolean;
  repairable: boolean;
  /** Any structured detail the rule wants to surface (ids, counts, samples). */
  metadata: Record<string, unknown>;
}

export interface RuleResult {
  rule: RuleId;
  findings: IntegrityFinding[];
  /** Whether the rule failed to execute at all (vs. cleanly finding nothing). */
  errored: boolean;
  errorMessage?: string;
  /** Milliseconds the rule took. */
  durationMs: number;
}

export interface RepairAction {
  rule: RuleId;
  /** Human-friendly description of what we're about to change. */
  description: string;
  /** Before-state captured for audit trail (kept small). */
  before: Record<string, unknown>;
  /** After-state we intend to write. */
  after: Record<string, unknown>;
  /** A function that performs the write. Idempotent. Returns true on success. */
  apply: () => Promise<boolean>;
}

export interface RepairReport {
  rule: RuleId;
  applied: boolean;
  reason: string;
  durationMs: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface UserAuditReport {
  userId: string;
  ranAt: string;       // ISO timestamp
  skipped: boolean;
  skipReason?: string;
  rulesRun: RuleResult[];
  repairs: RepairReport[];
  totalDurationMs: number;
}

/** Soft caps that bound any single tick of the integrity cron. */
export const INTEGRITY_LIMITS = {
  /** Max users processed in a single cron tick. */
  usersPerTick: 50,
  /** Max repairs per user per tick — runaway protection. */
  repairsPerUser: 10,
  /** Skip a user whose chat was active in the last N minutes. */
  activeUserSkipMinutes: 15,
  /** Skip a user audited within the last N hours. */
  recentAuditSkipHours: 20,
  /** A rule that runs slower than this is logged as a perf warning. */
  perRuleSlowMs: 250,
} as const;

/** Severity → numeric for log/score arithmetic. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 3,
  high: 6,
  critical: 10,
};
