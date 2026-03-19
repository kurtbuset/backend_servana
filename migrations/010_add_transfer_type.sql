-- Migration: Add transfer_type column to chat_transfer_log
-- This adds the transfer_type column to track how the transfer was initiated

-- Add transfer_type column
ALTER TABLE public.chat_transfer_log 
ADD COLUMN IF NOT EXISTS transfer_type text NULL;

-- Add check constraint for transfer_type
ALTER TABLE public.chat_transfer_log
ADD CONSTRAINT chat_transfer_log_transfer_type_check 
CHECK (transfer_type IS NULL OR transfer_type = ANY (ARRAY['manual'::text, 'auto_reassign'::text, 'agent_offline'::text]));

-- Update existing records to have 'manual' as default
UPDATE public.chat_transfer_log
SET transfer_type = 'manual'
WHERE transfer_type IS NULL;

-- Add comment
COMMENT ON COLUMN public.chat_transfer_log.transfer_type IS 
  'Type of transfer: manual (user-initiated), auto_reassign (system reassignment), agent_offline (agent went offline)';

-- Migration complete
