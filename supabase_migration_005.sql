-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 005: MISSING CORE TABLES & HARDENED POLICIES
-- ================================================================================
-- Execute this migration script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- to create the missing tables queried by API routes and add missing RLS policies.

-- 1. REJECTED EVALUATIONS & PAWN EVIDENCE TABLE
CREATE TABLE IF NOT EXISTS public.rejected_evaluations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    air_weight NUMERIC(10,3) DEFAULT 0,
    water_weight NUMERIC(10,3) DEFAULT 0,
    specific_gravity NUMERIC(10,3) DEFAULT 0,
    estimated_karat TEXT,
    asking_amount NUMERIC(12,2) DEFAULT 0,
    true_value NUMERIC(12,2) DEFAULT 0,
    status TEXT, -- Stores 'BILL:<bill_no>' or 'REJECTED'
    air_weight_photo_url TEXT,
    water_weight_photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rejected_evaluations_status ON public.rejected_evaluations(status);
CREATE INDEX IF NOT EXISTS idx_rejected_evaluations_created_at ON public.rejected_evaluations(created_at DESC);

ALTER TABLE public.rejected_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public rejected_evaluations all" ON public.rejected_evaluations;
CREATE POLICY "Public rejected_evaluations all" ON public.rejected_evaluations FOR ALL USING (true);


-- 2. SYSTEM SETTINGS TABLE (SMS Gateway, Branch Defaults)
CREATE TABLE IF NOT EXISTS public.system_settings (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public system_settings all" ON public.system_settings;
CREATE POLICY "Public system_settings all" ON public.system_settings FOR ALL USING (true);


-- 3. SMS LOGS TABLE (Outgoing SMS Tracking)
CREATE TABLE IF NOT EXISTS public.sms_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    ticket_no TEXT,
    amount NUMERIC(12,2),
    type TEXT DEFAULT 'RECEIPT',
    status TEXT DEFAULT 'SENT',
    gateway TEXT,
    branch_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON public.sms_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON public.sms_logs(phone);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public sms_logs all" ON public.sms_logs;
CREATE POLICY "Public sms_logs all" ON public.sms_logs FOR ALL USING (true);


-- 4. CCTV SETTINGS TABLE (Camera Retention & Stream Settings)
CREATE TABLE IF NOT EXISTS public.cctv_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    retention_days INTEGER DEFAULT 30,
    auto_record BOOLEAN DEFAULT TRUE,
    storage_quota_gb INTEGER DEFAULT 500,
    fps INTEGER DEFAULT 15,
    resolution TEXT DEFAULT '1080p',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.cctv_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public cctv_settings all" ON public.cctv_settings;
CREATE POLICY "Public cctv_settings all" ON public.cctv_settings FOR ALL USING (true);


-- 5. ADD MISSING UPDATE & DELETE POLICIES FOR STOCK_CUSTOMERS
ALTER TABLE public.stock_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Stock customers update" ON public.stock_customers;
DROP POLICY IF EXISTS "Stock customers delete" ON public.stock_customers;
CREATE POLICY "Stock customers update" ON public.stock_customers FOR UPDATE USING (true);
CREATE POLICY "Stock customers delete" ON public.stock_customers FOR DELETE USING (true);
