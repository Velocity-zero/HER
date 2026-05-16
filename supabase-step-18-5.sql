-- ══════════════════════════════════════════════════════════════════════════
-- HER — Step 18.5: Nightly Integrity & Self-Healing Reconciliation
-- Run once in Supabase SQL Editor. Safe to re-run.
--
-- Adds two tiny bookkeeping tables for the nightly integrity cron:
--   • integrity_checkpoints — a single-row-per-cursor table that lets the
--     batched audit pick up where it left off across cron ticks. The
--     audit never scans the whole DB in one tick.
--   • integrity_state       — per-user health bookkeeping (when was the
--     last check, when was the last repair, a rolling integrity_score).
--     Optional, but useful for observability and for skipping users that
--     were already audited recently.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Cursor table for batched audits ─────────────────────
CREATE TABLE IF NOT EXISTS integrity_checkpoints (
  id          TEXT PRIMARY KEY,            -- e.g. 'users'
  cursor      TEXT,                        -- last processed user_id (uuid as text)
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Per-user integrity bookkeeping ──────────────────────
CREATE TABLE IF NOT EXISTS integrity_state (
  user_id                  UUID PRIMARY KEY,
  last_integrity_check_at  TIMESTAMPTZ,
  last_integrity_repair_at TIMESTAMPTZ,
  integrity_score          REAL DEFAULT 1.0,   -- 0.0–1.0, 1.0 = clean
  last_findings            JSONB,              -- last audit's findings summary
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_state_check_at
  ON integrity_state (last_integrity_check_at);

-- ── 3. RLS ─────────────────────────────────────────────────
-- These tables are server-side only — the cron uses the service role.
-- No user-facing reads. We still enable RLS so a leaked anon key cannot
-- read or write them.
ALTER TABLE integrity_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrity_state       ENABLE ROW LEVEL SECURITY;

-- (No policies = no access via anon/auth role. Service role bypasses RLS.)
