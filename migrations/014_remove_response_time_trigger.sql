-- ===========================
-- Migration: Remove response time calculation trigger and function
-- ===========================
-- This migration removes the database trigger that automatically calculates response times
-- The business logic is now handled in the backend application layer

-- Drop the trigger
DROP TRIGGER IF EXISTS trigger_enhanced_response_time ON chat;
DROP TRIGGER IF EXISTS trigger_calculate_response_time ON chat;

-- Drop the functions
DROP FUNCTION IF EXISTS calculate_individual_response_time();
DROP FUNCTION IF EXISTS calculate_response_time();

-- Add comments explaining the change
COMMENT ON COLUMN chat.response_time_seconds IS 'Response time in seconds - calculated by application logic';
COMMENT ON COLUMN chat_group.total_response_time_seconds IS 'Total response time for all agent messages - managed by application logic';
COMMENT ON COLUMN chat_group.total_agent_responses IS 'Total number of agent responses - managed by application logic';
COMMENT ON COLUMN chat_group.average_response_time_seconds IS 'Average response time (ART) - managed by application logic';

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 014: Removed response time calculation triggers and functions';
  RAISE NOTICE 'Business logic for calculating response times is now handled in backend service';
  RAISE NOTICE 'Analytics calculations moved to application layer for better control and maintainability';
END $$;