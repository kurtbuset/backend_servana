-- Migration: Add granular macro permissions
-- Date: 2026-03-10
-- Description: Add separate permissions for viewing, adding, editing, and deleting macros

-- Add new macro permission columns
ALTER TABLE privilege 
ADD COLUMN IF NOT EXISTS priv_can_view_macros BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_add_macros BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_edit_macros BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS priv_can_delete_macros BOOLEAN DEFAULT FALSE;

-- Update existing roles to maintain current functionality
-- Users who had priv_can_use_canned_mess should get all four new permissions
UPDATE privilege 
SET 
    priv_can_view_macros = TRUE,
    priv_can_add_macros = TRUE,
    priv_can_edit_macros = TRUE,
    priv_can_delete_macros = TRUE
WHERE priv_can_use_canned_mess = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN privilege.priv_can_view_macros IS 'Permission to view macros list and details';
COMMENT ON COLUMN privilege.priv_can_add_macros IS 'Permission to create new macros';
COMMENT ON COLUMN privilege.priv_can_edit_macros IS 'Permission to modify existing macros';
COMMENT ON COLUMN privilege.priv_can_delete_macros IS 'Permission to delete macros';