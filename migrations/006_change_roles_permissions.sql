-- Migration: Add granular change roles permissions
-- Date: 2026-03-10
-- Description: Add separate permissions for viewing and editing user role assignments

-- Add new change roles permission columns
ALTER TABLE privilege 
ADD COLUMN IF NOT EXISTS priv_can_view_change_roles BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_edit_change_roles BOOLEAN DEFAULT FALSE;

-- Update existing roles to maintain current functionality
-- Users who had priv_can_assign_role should get both new permissions
UPDATE privilege 
SET 
    priv_can_view_change_roles = TRUE,
    priv_can_edit_change_roles = TRUE
WHERE priv_can_assign_role = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN privilege.priv_can_view_change_roles IS 'Permission to view the change roles screen and user role assignments';
COMMENT ON COLUMN privilege.priv_can_edit_change_roles IS 'Permission to modify user role assignments and toggle user status';