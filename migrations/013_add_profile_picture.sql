-- Migration: Add profile picture column to profile table
-- Date: 2024-03-23

-- Add prof_picture column to profile table
ALTER TABLE profile
ADD COLUMN IF NOT EXISTS prof_picture TEXT;

-- Add comment to column
COMMENT ON COLUMN profile.prof_picture IS 'URL to profile picture stored in Supabase Storage';

-- Create index for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_profile_picture ON profile(prof_picture) WHERE prof_picture IS NOT NULL;
