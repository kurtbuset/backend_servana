-- Migration: Add granular department permissions
-- Date: 2026-03-10
-- Description: Add separate permissions for viewing, adding, and editing departments

-- Add new department permission columns
ALTER TABLE privilege 
ADD COLUMN IF NOT EXISTS priv_can_view_dept BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_add_dept BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_edit_dept BOOLEAN DEFAULT FALSE;

-- Update existing roles to maintain current functionality
-- Users who had priv_can_manage_dept should get all three new permissions
UPDATE privilege 
SET 
    priv_can_view_dept = TRUE,
    priv_can_add_dept = TRUE,
    priv_can_edit_dept = TRUE
WHERE priv_can_manage_dept = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN privilege.priv_can_view_dept IS 'Permission to view departments list and details';
COMMENT ON COLUMN privilege.priv_can_add_dept IS 'Permission to create new departments';
COMMENT ON COLUMN privilege.priv_can_edit_dept IS 'Permission to modify existing departments';