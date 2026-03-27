-- ===========================
-- Migration: Remove mark_chat_resolved trigger and function
-- ===========================
-- This migration removes the database trigger that automatically sets resolved_at
-- The business logic is now handled in the backend application layer

-- Drop the trigger
DROP TRIGGER IF EXISTS trigger_mark_resolved ON chat_group;

-- Drop the function
DROP FUNCTION IF EXISTS mark_chat_resolved();

-- Add comment explaining the change
COMMENT ON COLUMN chat_group.resolved_at IS 'Timestamp when chat was resolved - managed by application logic';

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 013: Removed trigger_mark_resolved and mark_chat_resolved function';
  RAISE NOTICE 'Business logic for setting resolved_at is now handled in backend service';
END $$;