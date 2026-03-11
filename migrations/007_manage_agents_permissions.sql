-- Migration: Add granular manage agents permissions
-- Date: 2026-03-10
-- Description: Adds granular permissions for manage agents functionality

-- Add new manage agents permission columns to privilege table
ALTER TABLE privilege 
ADD COLUMN priv_can_view_manage_agents BOOLEAN DEFAULT FALSE,
ADD COLUMN priv_can_view_agents_info BOOLEAN DEFAULT FALSE,
ADD COLUMN priv_can_create_agent_account BOOLEAN DEFAULT FALSE,
ADD COLUMN priv_can_edit_manage_agents BOOLEAN DEFAULT FALSE,
ADD COLUMN priv_can_edit_dept_manage_agents BOOLEAN DEFAULT FALSE,
ADD COLUMN priv_can_view_analytics_manage_agents BOOLEAN DEFAULT FALSE;

-- Add comments for documentation
COMMENT ON COLUMN privilege.priv_can_view_manage_agents IS 'Permission to view the manage agents screen and agent list';
COMMENT ON COLUMN privilege.priv_can_view_agents_info IS 'Permission to view detailed agent information and profiles';
COMMENT ON COLUMN privilege.priv_can_create_agent_account IS 'Permission to create new agent accounts';
COMMENT ON COLUMN privilege.priv_can_edit_manage_agents IS 'Permission to edit agent details and settings';
COMMENT ON COLUMN privilege.priv_can_edit_dept_manage_agents IS 'Permission to edit agent department assignments';
COMMENT ON COLUMN privilege.priv_can_view_analytics_manage_agents IS 'Permission to view agent analytics and performance data';