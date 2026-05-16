-- ══════════════════════════════════════════════════════════════════════════
-- Step 18.4 — Editable & Deletable Messages
-- Run once in Supabase SQL Editor.
--
-- What this does:
--   • Adds edited_at  — timestamp of the last user edit (null = never edited)
--   • Adds deleted_at — timestamp of soft-delete   (null = not deleted)
--   • Adds is_deleted — boolean flag for efficient WHERE-clause filtering
--   • Adds a partial index to make "load messages, skip deleted" fast
--
-- Safe to re-run: all operations use IF NOT EXISTS / IF EXISTS guards.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN DEFAULT FALSE;

-- Partial index: only indexes non-deleted rows, so the common page-load
-- query (conversation_id + NOT is_deleted, ordered by created_at) is cheap.
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted
  ON messages (conversation_id, created_at)
  WHERE is_deleted = FALSE;
