-- Add voice note and audio columns to messages table
-- Run this in your Supabase SQL Editor

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS audio_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS audio_duration REAL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_voice_note BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voice_emotion TEXT DEFAULT NULL;

-- Index for querying voice notes quickly if needed
CREATE INDEX IF NOT EXISTS idx_messages_is_voice_note ON messages (is_voice_note) WHERE is_voice_note IS TRUE;
