-- Migration: Add prof_created_at column to profile table
-- This tracks when each profile was created

-- Add prof_created_at column with default value
ALTER TABLE public.profile 
ADD COLUMN IF NOT EXISTS prof_created_at timestamp without time zone NULL DEFAULT now();

-- Set prof_created_at for existing records (use prof_updated_at as fallback, or current time)
UPDATE public.profile 
SET prof_created_at = COALESCE(prof_updated_at, now())
WHERE prof_created_at IS NULL;

-- Make the column NOT NULL after backfilling existing data
ALTER TABLE public.profile 
ALTER COLUMN prof_created_at SET NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.profile.prof_created_at IS 'Timestamp when the profile was created';
