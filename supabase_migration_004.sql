-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 004: STOCK INTERESTS SEPARATE TABLE
-- ================================================================================
-- Execute this migration script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- to create the dedicated stock_interests table for recording interest additions under stock bills.

CREATE TABLE IF NOT EXISTS public.stock_interests (
    id TEXT PRIMARY KEY DEFAULT ('si_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6)),
    bill_no TEXT NOT NULL,
    item_id TEXT,
    date DATE NOT NULL,
    interest_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    branch TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for instant lookup by bill, branch, and date
CREATE INDEX IF NOT EXISTS idx_stock_interests_bill_branch ON public.stock_interests(bill_no, branch);
CREATE INDEX IF NOT EXISTS idx_stock_interests_date ON public.stock_interests(date);
CREATE INDEX IF NOT EXISTS idx_stock_interests_item_id ON public.stock_interests(item_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.stock_interests ENABLE ROW LEVEL SECURITY;

-- Allow public / authenticated access
DROP POLICY IF EXISTS "Public stock_interests select" ON public.stock_interests;
DROP POLICY IF EXISTS "Public stock_interests insert" ON public.stock_interests;
DROP POLICY IF EXISTS "Public stock_interests update" ON public.stock_interests;
DROP POLICY IF EXISTS "Public stock_interests delete" ON public.stock_interests;

CREATE POLICY "Public stock_interests select" ON public.stock_interests FOR SELECT USING (true);
CREATE POLICY "Public stock_interests insert" ON public.stock_interests FOR INSERT WITH CHECK (true);
CREATE POLICY "Public stock_interests update" ON public.stock_interests FOR UPDATE USING (true);
CREATE POLICY "Public stock_interests delete" ON public.stock_interests FOR DELETE USING (true);
