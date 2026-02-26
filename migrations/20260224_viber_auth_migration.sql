-- Viber-Style Authentication Migration
-- Date: 2026-02-24
-- Description: Migrate from password-based to passwordless (phone + OTP) authentication
-- 
-- This migration:
-- 1. Makes client_password nullable (for backward compatibility during migration)
-- 2. Adds unique constraint on (client_country_code, client_number)
-- 3. Drops client_is_verified column (OTP verification is sufficient)
-- 4. Adds otp_type column to otp_sms table
-- 5. Adds client_id column to otp_sms table
-- 6. Makes profile fields nullable (optional profile setup)
-- 7. Adds indexes for performance

-- ============================================================================
-- FORWARD MIGRATION
-- ============================================================================

BEGIN;

-- 1. Make client_password nullable (for migration period)
-- This allows new users to be created without passwords while old users still have them
ALTER TABLE public.client 
  ALTER COLUMN client_password DROP NOT NULL;

COMMENT ON COLUMN public.client.client_password IS 
  'Password field - nullable for passwordless authentication. Will be removed in future migration.';

-- 2. Add unique constraint on (client_country_code, client_number)
-- First, drop the existing unique constraint on client_number only
ALTER TABLE public.client 
  DROP CONSTRAINT IF EXISTS client_client_number_key;

-- Add composite unique constraint on country code + number
ALTER TABLE public.client 
  ADD CONSTRAINT client_phone_unique UNIQUE (client_country_code, client_number);

COMMENT ON CONSTRAINT client_phone_unique ON public.client IS 
  'Ensures phone numbers are unique across country codes';

-- 3. Drop client_is_verified column
-- OTP verification is now sufficient, no need for separate verification flag
ALTER TABLE public.client 
  DROP COLUMN IF EXISTS client_is_verified;

-- 4. Add otp_type column to otp_sms table
-- Distinguishes between registration and login OTPs
ALTER TABLE public.otp_sms 
  ADD COLUMN IF NOT EXISTS otp_type text DEFAULT 'registration' 
  CHECK (otp_type IN ('registration', 'login'));

COMMENT ON COLUMN public.otp_sms.otp_type IS 
  'Type of OTP: registration (new user) or login (existing user)';

-- 5. Add client_id column to otp_sms table
-- Links login OTPs to existing clients
ALTER TABLE public.otp_sms 
  ADD COLUMN IF NOT EXISTS client_id bigint NULL 
  REFERENCES public.client(client_id) ON DELETE CASCADE;

COMMENT ON COLUMN public.otp_sms.client_id IS 
  'Links OTP to existing client for login flow. NULL for registration OTPs.';

-- 6. Make profile fields nullable (optional profile setup)
-- Users can now skip profile setup during registration
ALTER TABLE public.profile 
  ALTER COLUMN prof_firstname DROP NOT NULL,
  ALTER COLUMN prof_lastname DROP NOT NULL;

-- These fields are already nullable, but we ensure they stay that way
-- (kept for web/agent side usage)
ALTER TABLE public.profile 
  ALTER COLUMN prof_middlename DROP NOT NULL,
  ALTER COLUMN prof_street_address DROP NOT NULL,
  ALTER COLUMN prof_region_info DROP NOT NULL,
  ALTER COLUMN prof_postal_code DROP NOT NULL;

COMMENT ON COLUMN public.profile.prof_firstname IS 
  'First name - optional for mobile users, can be added later';
COMMENT ON COLUMN public.profile.prof_lastname IS 
  'Last name - optional for mobile users, can be added later';

-- 7. Add indexes for performance
-- Index on otp_sms.client_id for faster login OTP lookups
CREATE INDEX IF NOT EXISTS idx_otp_sms_client_id 
  ON public.otp_sms(client_id);

-- Index on otp_sms phone fields for faster OTP lookups
CREATE INDEX IF NOT EXISTS idx_otp_sms_phone 
  ON public.otp_sms(phone_country_code, phone_number);

-- Index on otp_sms.created_at for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_otp_sms_created_at 
  ON public.otp_sms(created_at);

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to verify migration success)
-- ============================================================================

-- Verify client_password is nullable
-- SELECT column_name, is_nullable, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'client' AND column_name = 'client_password';

-- Verify unique constraint on phone
-- SELECT constraint_name, constraint_type 
-- FROM information_schema.table_constraints 
-- WHERE table_name = 'client' AND constraint_name = 'client_phone_unique';

-- Verify client_is_verified is dropped
-- SELECT column_name 
-- FROM information_schema.columns 
-- WHERE table_name = 'client' AND column_name = 'client_is_verified';

-- Verify otp_sms new columns
-- SELECT column_name, is_nullable, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'otp_sms' AND column_name IN ('otp_type', 'client_id');

-- Verify profile fields are nullable
-- SELECT column_name, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'profile' 
-- AND column_name IN ('prof_firstname', 'prof_lastname', 'prof_middlename', 
--                     'prof_street_address', 'prof_region_info', 'prof_postal_code');

-- Verify indexes exist
-- SELECT indexname, tablename 
-- FROM pg_indexes 
-- WHERE tablename IN ('otp_sms', 'client') 
-- AND indexname IN ('idx_otp_sms_client_id', 'idx_otp_sms_phone', 'idx_otp_sms_created_at');

