-- Add message status tracking columns to chat table
-- This migration adds timestamp columns for tracking message delivery and read status

-- Add the missing columns
ALTER TABLE public.chat 
ADD COLUMN IF NOT EXISTS chat_delivered_at TIMESTAMP WITHOUT TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS chat_read_at TIMESTAMP WITHOUT TIME ZONE NULL;

-- Add indexes for performance on the new columns
CREATE INDEX IF NOT EXISTS idx_chat_delivered_at ON public.chat(chat_delivered_at);
CREATE INDEX IF NOT EXISTS idx_chat_read_at ON public.chat(chat_read_at);

-- Optional: Update existing messages to have delivered/read status based on the old boolean column
-- Uncomment the following lines if you want to migrate existing data:
-- UPDATE public.chat 
-- SET chat_read_at = chat_created_at 
-- WHERE chat_is_read = true AND chat_read_at IS NULL;