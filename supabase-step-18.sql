-- HER — Step 18.X: Synthetic Self Model persistence
--
-- One row per user holding HER's evolving internal vector.
-- Updated on every interaction signal extraction; decayed on read.
--
-- The values are bounded behavioral signals — not emotion labels — and
-- are never exposed to the user. Only HER's prompt sees the derived brief.
--
-- Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS her_self_state (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read latency is dominated by the PK lookup; updated_at index is only
-- useful if we ever want to sweep stale rows for batch decay.
CREATE INDEX IF NOT EXISTS idx_her_self_state_updated_at
  ON her_self_state (updated_at);

-- ── RLS ────────────────────────────────────────────────────
-- The chat & interaction APIs run server-side with the service role and
-- already authorise the userId before touching this table, so we keep RLS
-- restrictive: users may only read/write their own row directly.

ALTER TABLE her_self_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_state_select_own" ON her_self_state;
CREATE POLICY "self_state_select_own"
  ON her_self_state FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "self_state_upsert_own" ON her_self_state;
CREATE POLICY "self_state_upsert_own"
  ON her_self_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "self_state_update_own" ON her_self_state;
CREATE POLICY "self_state_update_own"
  ON her_self_state FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
