-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 008: AUDIT SECURITY, INTEGRITY & MISSING SCHEMA FIX
-- ================================================================================
-- Reviewed: 26 Oct 2026
-- This migration script fixes all Critical (C1, C2, C3), High (H1, H2, H5),
-- and Medium (M12, M13, M15) database issues identified in the Technical Audit.
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor).
-- ================================================================================

-- --------------------------------------------------------------------------------
-- 1. SECURITY HELPER FUNCTION (C1, C3)
-- --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- --------------------------------------------------------------------------------
-- 2. CLOSE OPEN PUBLIC RLS POLICIES (C1)
-- --------------------------------------------------------------------------------
-- Drop all insecure policies that grant full read/write to the public role
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname 
    FROM pg_policies
    WHERE schemaname = 'public' 
      AND roles @> ARRAY['public'::name]
      AND policyname NOT ILIKE '%service%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Enable RLS across all tables
ALTER TABLE IF EXISTS public.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branch_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pawns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pawn_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.daily_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.daily_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.daily_ledger_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.journal_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.journal_entry_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vault_transfer ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read only their own profile
DROP POLICY IF EXISTS "profiles read own" ON public.profiles;
CREATE POLICY "profiles read own" ON public.profiles
FOR SELECT TO authenticated USING (id = auth.uid());

-- Allow authenticated users to update their own profile name / last login
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles update own" ON public.profiles
FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Allow all authenticated users to read branches for dropdowns
DROP POLICY IF EXISTS "authenticated read branches" ON public.branches;
CREATE POLICY "authenticated read branches" ON public.branches
FOR SELECT TO authenticated USING (is_active = true);

-- Note: All mutations and financial queries run via the server API routes using the
-- Supabase Service-Role key, which bypasses RLS and enforces branch/role rules strictly.

-- --------------------------------------------------------------------------------
-- 3. RESTRICT STORAGE BUCKETS (C2)
-- --------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Upload Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Pawn Images" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Pawn Images" ON storage.objects;

-- Allow only authenticated staff to upload collateral and avatars
CREATE POLICY "Authenticated upload avatars" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Authenticated upload pawn images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pawn_images');

-- --------------------------------------------------------------------------------
-- 4. FIX NULL BILL NUMBERS & ENFORCE NOT NULL (H1)
-- --------------------------------------------------------------------------------
-- Backfill the 7 pawns that were saved with NULL bill number
UPDATE public.pawns 
SET bill_no = CONCAT(COALESCE(branch_id, 'HQ'), '-REC-', SUBSTRING(id::text, 1, 6))
WHERE bill_no IS NULL OR TRIM(bill_no) = '';

-- Enforce NOT NULL constraint on bill_no
ALTER TABLE public.pawns ALTER COLUMN bill_no SET NOT NULL;

-- --------------------------------------------------------------------------------
-- 5. BACKFILL MISSING COLLATERAL ROWS IN pawn_items (H2)
-- --------------------------------------------------------------------------------
-- Backfill collateral rows for all legacy pawns that had missing pawn_items
INSERT INTO public.pawn_items (id, pawn_id, item_type, purity, weight_grams, weight_mg, appraised_value, description)
SELECT 
  gen_random_uuid(),
  p.id,
  COALESCE(p.description, 'Gold Collateral'),
  '22K',
  COALESCE(p.weight_grams, (p.weight_mg / 1000.0), 0),
  COALESCE(p.weight_mg, (p.weight_grams * 1000.0), 0),
  COALESCE(p.appraised_value, p.disbursed_amount, 0),
  CONCAT('Collateral Item (', p.bill_no, ')')
FROM public.pawns p
WHERE NOT EXISTS (
  SELECT 1 FROM public.pawn_items pi WHERE pi.pawn_id = p.id
);

-- --------------------------------------------------------------------------------
-- 6. CREATE MISSING CCTV & SYSTEM SETTINGS TABLES (H5)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cctv_cameras (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    camera_name TEXT NOT NULL,
    stream_url TEXT,
    ip_address TEXT,
    location_desc TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cctv_recordings (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    camera_id TEXT NOT NULL,
    pawn_id TEXT,
    cashier_id TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration INTEGER DEFAULT 20,
    file_path TEXT,
    file_size BIGINT DEFAULT 0,
    mime_type TEXT DEFAULT 'video/mp4',
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RECORDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cctv_audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    recording_id TEXT,
    action TEXT NOT NULL,
    performed_by TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cctv_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    pre_event_seconds INTEGER DEFAULT 10,
    post_event_seconds INTEGER DEFAULT 10,
    resolution TEXT DEFAULT '1080p',
    storage_retention_days INTEGER DEFAULT 90,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_branch_cctv_settings UNIQUE (branch_id)
);

CREATE TABLE IF NOT EXISTS public.sms_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id TEXT,
    recipient_phone TEXT NOT NULL,
    message_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SENT',
    gateway_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

ALTER TABLE public.cctv_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------------
-- 7. CHART OF ACCOUNTS: ADD VAULT CASH (M12)
-- --------------------------------------------------------------------------------
INSERT INTO public.account (id, account_code, account_name, account_type, currency, is_active)
SELECT gen_random_uuid(), '1010', 'Vault Cash (Asset)', 'ASSET', 'LKR', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.account WHERE account_name = 'Vault Cash (Asset)'
);

-- --------------------------------------------------------------------------------
-- 8. DEACTIVATE TEST BRANCHES IN PRODUCTION (M13)
-- --------------------------------------------------------------------------------
UPDATE public.branches 
SET is_active = false 
WHERE UPPER(id) IN ('TEST', 'TESTBRANCH');

-- --------------------------------------------------------------------------------
-- 9. CHECK CONSTRAINTS ON STATUS VALUES (M15)
-- --------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_pawns_status'
  ) THEN
    ALTER TABLE public.pawns 
    ADD CONSTRAINT check_pawns_status 
    CHECK (status IN ('ACTIVE', 'PENDING_APPROVAL', 'AUDITED_PENDING_APPROVAL', 'REQUIRES_RECHECK', 'REDEEMED', 'COMPLETED', 'SETTLED', 'DEFAULTED', 'FLAGGED'));
  END IF;
END $$;
