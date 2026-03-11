-- Analytics Schema Migration
-- Adds analytics capabilities to match Servana production schema
-- Uses: chat, chat_group, sys_user, client tables

-- ===========================
-- 1. Add Analytics Columns to chat_group table
-- ===========================

-- Add columns for tracking response times and resolution
ALTER TABLE chat_group 
ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP WITHOUT TIME ZONE,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITHOUT TIME ZONE,
ADD COLUMN IF NOT EXISTS response_time_minutes NUMERIC(10, 2);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_chat_group_first_response_at ON chat_group(first_response_at);
CREATE INDEX IF NOT EXISTS idx_chat_group_resolved_at ON chat_group(resolved_at);
CREATE INDEX IF NOT EXISTS idx_chat_group_created_at ON chat_group(created_at);

-- ===========================
-- 2. Create Function: Get Message Analytics
-- ===========================

-- Function to get message counts grouped by time period
CREATE OR REPLACE FUNCTION get_message_analytics(
  time_interval INTERVAL,
  date_format TEXT
)
RETURNS TABLE (
  label TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TO_CHAR(chat_created_at, date_format) as label,
    COUNT(*)::BIGINT as count
  FROM chat
  WHERE chat_created_at >= NOW() - time_interval
  GROUP BY TO_CHAR(chat_created_at, date_format), DATE(chat_created_at)
  ORDER BY DATE(chat_created_at);
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- 3. Create Function: Get Response Time Analytics
-- ===========================

-- Function to get average response times grouped by time period
CREATE OR REPLACE FUNCTION get_response_time_analytics(
  time_interval INTERVAL,
  date_format TEXT
)
RETURNS TABLE (
  label TEXT,
  avg_minutes NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TO_CHAR(cg.created_at, date_format) as label,
    ROUND(AVG(cg.response_time_minutes)::NUMERIC, 2) as avg_minutes
  FROM chat_group cg
  WHERE cg.created_at >= NOW() - time_interval
    AND cg.response_time_minutes IS NOT NULL
  GROUP BY TO_CHAR(cg.created_at, date_format), DATE(cg.created_at)
  ORDER BY DATE(cg.created_at);
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- 4. Create Trigger Function: Calculate Response Time
-- ===========================

-- Function to automatically calculate response time when first agent responds
CREATE OR REPLACE FUNCTION calculate_response_time()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if this is an agent message (sys_user_id is not null)
  IF NEW.sys_user_id IS NOT NULL THEN
    -- Update chat_group with first response time if not already set
    UPDATE chat_group
    SET 
      first_response_at = NEW.chat_created_at,
      response_time_minutes = EXTRACT(EPOCH FROM (NEW.chat_created_at - chat_group.created_at))/60
    WHERE chat_group_id = NEW.chat_group_id
      AND first_response_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- 5. Create Trigger: Auto-calculate Response Time
-- ===========================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_calculate_response_time ON chat;

-- Create trigger to automatically calculate response time on new messages
CREATE TRIGGER trigger_calculate_response_time
  AFTER INSERT ON chat
  FOR EACH ROW
  EXECUTE FUNCTION calculate_response_time();

-- ===========================
-- 6. Create Trigger Function: Mark Chat Resolved
-- ===========================

-- Function to automatically set resolved_at timestamp
CREATE OR REPLACE FUNCTION mark_chat_resolved()
RETURNS TRIGGER AS $$
BEGIN
  -- If status changed to 'resolved', set resolved_at timestamp
  IF NEW.status = 'resolved' AND (OLD.status IS NULL OR OLD.status != 'resolved') THEN
    NEW.resolved_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- 7. Create Trigger: Auto-mark Resolved
-- ===========================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_mark_resolved ON chat_group;

-- Create trigger for marking chats as resolved
CREATE TRIGGER trigger_mark_resolved
  BEFORE UPDATE ON chat_group
  FOR EACH ROW
  EXECUTE FUNCTION mark_chat_resolved();

-- ===========================
-- 8. Add Comments for Documentation
-- ===========================

COMMENT ON FUNCTION get_message_analytics IS 'Returns message count grouped by time period (daily/weekly/monthly/yearly)';
COMMENT ON FUNCTION get_response_time_analytics IS 'Returns average response time in minutes grouped by time period';
COMMENT ON FUNCTION calculate_response_time IS 'Automatically calculates response time when first agent message is sent';
COMMENT ON FUNCTION mark_chat_resolved IS 'Automatically sets resolved_at timestamp when chat status changes to resolved';

COMMENT ON COLUMN chat_group.first_response_at IS 'Timestamp of first agent response in the chat';
COMMENT ON COLUMN chat_group.resolved_at IS 'Timestamp when chat was marked as resolved';
COMMENT ON COLUMN chat_group.response_time_minutes IS 'Time in minutes from chat creation to first agent response';

-- ===========================
-- Migration Complete
-- ===========================

-- Verify the migration
DO $$
BEGIN
  RAISE NOTICE 'Analytics migration completed successfully!';
  RAISE NOTICE 'Added columns: first_response_at, resolved_at, response_time_minutes to chat_group';
  RAISE NOTICE 'Created functions: get_message_analytics, get_response_time_analytics';
  RAISE NOTICE 'Created triggers: calculate_response_time, mark_chat_resolved';
END $$;
