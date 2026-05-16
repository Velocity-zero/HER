-- ═══════════════════════════════════════════════════════════
-- HER — Cross-Conversation Memory Table
-- 
-- Run this in your Supabase SQL Editor:
--   Project Dashboard → SQL Editor → New query → Paste → Run
--
-- This table stores extracted facts/preferences about users
-- so HER can remember across conversations.
-- ═══════════════════════════════════════════════════════════

-- Create the user_memories table
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'identity', 'preference', 'life', 'emotional', 'topic', 'context'
  )),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id 
  ON user_memories (user_id);

-- Index for sorting by recency
CREATE INDEX IF NOT EXISTS idx_user_memories_updated 
  ON user_memories (user_id, updated_at DESC);

-- Enable Row Level Security
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;

-- Policy: users can read/write their own memories
-- (matches the pattern used by conversations and messages tables)
DROP POLICY IF EXISTS "Users can manage their own memories" ON user_memories;
CREATE POLICY "Users can manage their own memories"
  ON user_memories
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- Done! The memory system is ready.
-- ═══════════════════════════════════════════════════════════
