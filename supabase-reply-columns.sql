-- Add reply/quote columns to the messages table
-- Run this migration in your Supabase SQL Editor

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reply_to_content TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reply_to_role TEXT DEFAULT NULL;

-- Optional: index for faster lookups of replies to a specific message
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Add emoji reactions column (JSONB — stores { "❤️": ["user","her"], "😂": ["user"] })
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT NULL;

-- Add client_message_id column for mapping client-generated IDs to DB rows
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_client_message_id
  ON messages (client_message_id)
  WHERE client_message_id IS NOT NULL;
