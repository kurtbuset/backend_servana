-- Viber-Style Authentication Migration - ROLLBACK
-- Date: 2026-02-24
-- Description: Rollback script to revert passwordless authentication changes
-- 
-- WARNING: This rollback will:
-- 1. Restore client_password as NOT NULL (requires all clients to have passwords)
-- 2. Remove unique constraint on (client_country_code, client_number)
-- 3. Restore client_is_verified column
-- 4. Remove otp_type and client_id columns from otp_sms
-- 5. Restore profile fields as NOT NULL
-- 6. Remove new indexes
--
-- IMPORTANT: Before running this rollback:
-- - Ensure all clients have passwords set (or this will fail)
-- - Ensure all profiles have required fields populated
-- - Backup your database first!

-- ============================================================================
-- ROLLBACK MIGRATION
-- ============================================================================

BEGIN;

-- 1. Drop new indexes
DROP INDEX IF EXISTS public.idx_otp_sms_created_at;
DROP INDEX IF EXISTS public.idx_otp_sms_phone;
DROP INDEX IF EXISTS public.idx_otp_sms_client_id;

-- 2. Restore profile fields as NOT NULL
-- WARNING: This will fail if any profiles have NULL values in these fields
-- You may need to populate these fields first before running rollback

-- Uncomment these lines only if you're sure all profiles have these fields populated:
-- ALTER TABLE public.profile 
--   ALTER COLUMN prof_firstname SET NOT NULL,
--   ALTER COLUMN prof_lastname SET NOT NULL;

-- Note: middlename, street_address, region_info, postal_code were already nullable
-- so we don't need to change them back

-- 3. Remove client_id column from otp_sms
ALTER TABLE public.otp_sms 
  DROP COLUMN IF EXISTS client_id;

-- 4. Remove otp_type column from otp_sms
ALTER TABLE public.otp_sms 
  DROP COLUMN IF EXISTS otp_type;

-- 5. Restore client_is_verified column
ALTER TABLE public.client 
  ADD COLUMN IF NOT EXISTS client_is_verified boolean NULL DEFAULT false;

COMMENT ON COLUMN public.client.client_is_verified IS 
  'Indicates if client has verified their phone number';

-- 6. Remove composite unique constraint on phone
ALTER TABLE public.client 
  DROP CONSTRAINT IF EXISTS client_phone_unique;

-- 7. Restore unique constraint on client_number only
ALTER TABLE public.client 
  ADD CONSTRAINT client_client_number_key UNIQUE (client_number);

-- 8. Restore client_password as NOT NULL
-- WARNING: This will fail if any clients have NULL passwords
-- You must ensure all clients have passwords before running this

-- First, check if there are any clients without passwords:
DO $$
DECLARE
  null_password_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_password_count 
  FROM public.client 
  WHERE client_password IS NULL;
  
  IF null_password_count > 0 THEN
    RAISE EXCEPTION 'Cannot rollback: % clients have NULL passwords. Please set passwords for all clients first.', null_password_count;
  END IF;
END $$;

-- If the check passes, restore NOT NULL constraint
ALTER TABLE public.client 
  ALTER COLUMN client_password SET NOT NULL;

COMMENT ON COLUMN public.client.client_password IS 
  'Hashed password for client authentication';

COMMIT;

-- ============================================================================
-- POST-ROLLBACK VERIFICATION
-- ============================================================================

-- Verify client_password is NOT NULL
-- SELECT column_name, is_nullable, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'client' AND column_name = 'client_password';

-- Verify client_is_verified exists
-- SELECT column_name, is_nullable, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'client' AND column_name = 'client_is_verified';

-- Verify otp_sms columns are removed
-- SELECT column_name 
-- FROM information_schema.columns 
-- WHERE table_name = 'otp_sms' AND column_name IN ('otp_type', 'client_id');

-- Verify old unique constraint is restored
-- SELECT constraint_name, constraint_type 
-- FROM information_schema.table_constraints 
-- WHERE table_name = 'client' AND constraint_name = 'client_client_number_key';

-- Verify indexes are removed
-- SELECT indexname 
-- FROM pg_indexes 
-- WHERE tablename = 'otp_sms' 
-- AND indexname IN ('idx_otp_sms_client_id', 'idx_otp_sms_phone', 'idx_otp_sms_created_at');

