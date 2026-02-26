-- Migration: Remove password, add passwordless authentication
-- File: 20260224000000_passwordless_migration.sql
-- Goal: Match Viber's simplicity with OTP-only authentication

BEGIN;

-- Add last_login_at column (track user login activity)
ALTER TABLE public.client 
ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone NULL;

-- Make client_password nullable first (for safe migration)
ALTER TABLE public.client 
ALTER COLUMN client_password DROP NOT NULL;

-- Drop client_password column (passwordless authentication)
ALTER TABLE public.client 
DROP COLUMN IF EXISTS client_password;

-- Ensure client_is_verified exists and has default
ALTER TABLE public.client 
ALTER COLUMN client_is_verified SET DEFAULT false;

-- Ensure client_is_active exists and has default
ALTER TABLE public.client 
ALTER COLUMN client_is_active SET DEFAULT true;

-- Add index for performance on last_login_at
CREATE INDEX IF NOT EXISTS idx_client_last_login 
ON public.client(last_login_at);

-- Add index for phone lookup (if not exists)
CREATE INDEX IF NOT EXISTS idx_client_phone_lookup 
ON public.client(client_country_code, client_number);

-- Add comment to document the change
COMMENT ON TABLE public.client IS 'Client accounts using passwordless (OTP-based) authentication';

COMMIT;
