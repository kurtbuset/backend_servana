-- Migration: Add granular auto-reply permissions
-- Date: 2026-03-10
-- Description: Add separate permissions for viewing, adding, editing, and deleting auto-replies

-- Add new auto-reply permission columns
ALTER TABLE privilege 
ADD COLUMN IF NOT EXISTS priv_can_view_auto_reply BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_add_auto_reply BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_edit_auto_reply BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_delete_auto_reply BOOLEAN DEFAULT FALSE;

-- Update existing roles to maintain current functionality
-- Users who had priv_can_manage_auto_reply should get all four new permissions
UPDATE privilege 
SET 
    priv_can_view_auto_reply = TRUE,
    priv_can_add_auto_reply = TRUE,
    priv_can_edit_auto_reply = TRUE,
    priv_can_delete_auto_reply = TRUE
WHERE priv_can_manage_auto_reply = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN privilege.priv_can_view_auto_reply IS 'Permission to view auto-replies list and details';
COMMENT ON COLUMN privilege.priv_can_add_auto_reply IS 'Permission to create new auto-replies';
COMMENT ON COLUMN privilege.priv_can_edit_auto_reply IS 'Permission to modify existing auto-replies';
COMMENT ON COLUMN privilege.priv_can_delete_auto_reply IS 'Permission to delete auto-replies';