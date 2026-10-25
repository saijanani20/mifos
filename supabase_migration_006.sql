-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 006: SCHEMA INTEGRITY & DATA CONSTRAINTS
-- ================================================================================
-- Execute this migration script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- to add missing columns, storage buckets, unique constraints, and Chart of Accounts alignment.

-- 1. PAWN ITEMS: Add purity column and expand item_type length
ALTER TABLE public.pawn_items ADD COLUMN IF NOT EXISTS purity TEXT DEFAULT '22K';
ALTER TABLE public.pawn_items ALTER COLUMN item_type TYPE VARCHAR(100);

-- 2. PAWNS: Add packet_qr column for physical packet barcode/QR scanning
ALTER TABLE public.pawns ADD COLUMN IF NOT EXISTS packet_qr TEXT;
CREATE INDEX IF NOT EXISTS idx_pawns_packet_qr ON public.pawns(packet_qr);

-- 3. RESOLVE DUPLICATES & ADD UNIQUE CONSTRAINTS

-- 3.1 Pawns: Disambiguate duplicate (branch_id, bill_no) if any exist
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id, bill_no ORDER BY created_at) as rn
  FROM public.pawns
  WHERE bill_no IS NOT NULL
)
UPDATE public.pawns p
SET bill_no = p.bill_no || '-DUP' || (d.rn - 1)
FROM duplicates d
WHERE p.id = d.id AND d.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_branch_bill_no'
  ) THEN
    ALTER TABLE public.pawns ADD CONSTRAINT unique_branch_bill_no UNIQUE (branch_id, bill_no);
  END IF;
END $$;

-- 3.2 Stock Items: Disambiguate duplicate (branch_id, bill_no) in stock_items
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id, bill_no ORDER BY created_at) as rn
  FROM public.stock_items
  WHERE bill_no IS NOT NULL
)
UPDATE public.stock_items s
SET bill_no = s.bill_no || '-DUP' || (d.rn - 1)
FROM duplicates d
WHERE s.id = d.id AND d.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_branch_stock_bill_no'
  ) THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT unique_branch_stock_bill_no UNIQUE (branch_id, bill_no);
  END IF;
END $$;

-- 3.3 Clients: Disambiguate duplicate (branch_id, national_id) if any exist
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id, national_id ORDER BY created_at) as rn
  FROM public.clients
  WHERE national_id IS NOT NULL
)
UPDATE public.clients c
SET national_id = c.national_id || '-DUP' || (d.rn - 1)
FROM duplicates d
WHERE c.id = d.id AND d.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_branch_national_id'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT unique_branch_national_id UNIQUE (branch_id, national_id);
  END IF;
END $$;

-- 4. STORAGE BUCKETS SETUP (avatars and pawn_images)
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('avatars', 'avatars', true),
  ('pawn_images', 'pawn_images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS Policies
DROP POLICY IF EXISTS "Public Read Avatars" ON storage.objects;
CREATE POLICY "Public Read Avatars" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Public Upload Avatars" ON storage.objects;
CREATE POLICY "Public Upload Avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Public Update Avatars" ON storage.objects;
CREATE POLICY "Public Update Avatars" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Public Read Pawn Images" ON storage.objects;
CREATE POLICY "Public Read Pawn Images" ON storage.objects FOR SELECT USING (bucket_id = 'pawn_images');

DROP POLICY IF EXISTS "Public Upload Pawn Images" ON storage.objects;
CREATE POLICY "Public Upload Pawn Images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'pawn_images');

-- 5. CHART OF ACCOUNTS ALIGNMENT
INSERT INTO public.account (id, name, type, balance, interest_rate, status) VALUES
    ('1035', 'Pawn Loan Portfolio (Asset)', 'Asset', 0.00, 0.00, 'Active'),
    ('4015', 'Interest & Fee Income (Revenue)', 'Revenue', 0.00, 0.00, 'Active')
ON CONFLICT (id) DO NOTHING;

-- 6. CANONICAL BRANCHES SEED
INSERT INTO public.branches (id, name, is_active) VALUES
    ('HQ', 'Head Office', true),
    ('KHT', 'Kahathuduwa', true),
    ('KTW', 'Kottawa', true),
    ('KOT', 'Kotikawatta', true),
    ('PND', 'Panadura', true),
    ('BRL', 'Borella', true),
    ('DHW', 'Dehiwala', true),
    ('DMT', 'Dematagoda', true),
    ('HMG', 'Homagama', true),
    ('KDW', 'Kadawatha', true),
    ('KIR', 'Kiribathgoda', true),
    ('W2', 'Wattala 2', true),
    ('W3', 'Wattala 3', true),
    ('W4', 'Wattala 4', true),
    ('TEST', 'Test Branch', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;

INSERT INTO public.branch_status (branch_id, status) VALUES
    ('HQ', 'OPEN'),
    ('KHT', 'CLOSED'),
    ('KTW', 'CLOSED'),
    ('KOT', 'CLOSED'),
    ('PND', 'CLOSED'),
    ('BRL', 'CLOSED'),
    ('DHW', 'CLOSED'),
    ('DMT', 'CLOSED'),
    ('HMG', 'CLOSED'),
    ('KDW', 'CLOSED'),
    ('KIR', 'CLOSED'),
    ('W2', 'CLOSED'),
    ('W3', 'CLOSED'),
    ('W4', 'CLOSED'),
    ('TEST', 'CLOSED')
ON CONFLICT (branch_id) DO NOTHING;

-- 7. ENFORCE DOUBLE-ENTRY GENERAL LEDGER BALANCE CONSTRAINT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_journal_entry_balanced'
  ) THEN
    ALTER TABLE public.journal_entry ADD CONSTRAINT check_journal_entry_balanced CHECK (total_debit = total_credit);
  END IF;
END $$;

