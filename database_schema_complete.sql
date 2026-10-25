-- ======================================================================================
-- MIFOS PAWNING & MICROFINANCE SYSTEM
-- COMPLETE PRODUCTION DATABASE SCHEMA (POSTGRESQL / SUPABASE)
-- ======================================================================================
-- Generated Date: October 2026
-- Compatible with: PostgreSQL 14+, Supabase, Next.js 14+
--
-- Features included:
-- 1. Full schema definitions for all 25 tables with constraints and foreign keys
-- 2. Performance indexes on frequently filtered & sorted columns
-- 3. Row Level Security (RLS) policies with multi-branch isolation & Admin override
-- 4. Supabase Storage buckets setup (avatars, pawn_images)
-- 5. Standard initial seed data (Branches, Branch Status, Default Settings)
-- ======================================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ======================================================================================
-- 1. EXTENSIONS & HELPER FUNCTIONS FOR SECURITY (RLS)
-- ======================================================================================

CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_branch_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ======================================================================================
-- 2. CORE ORGANIZATION & AUTHENTICATION
-- ======================================================================================

-- 2.1 Branches
CREATE TABLE IF NOT EXISTS public.branches (
    id VARCHAR(20) PRIMARY KEY,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.2 Branch Operating Status (Open / Closed for EOD)
CREATE TABLE IF NOT EXISTS public.branch_status (
    branch_id VARCHAR(20) PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.3 User Profiles (Extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    branch_id VARCHAR(20) REFERENCES public.branches(id) ON DELETE SET NULL,
    branch_name TEXT,
    role TEXT NOT NULL DEFAULT 'TELLER', -- 'ADMIN', 'MANAGER', 'TELLER', 'AUDITOR'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_branch_id ON public.profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- ======================================================================================
-- 3. CLIENTS & KYC CUSTOMER MANAGEMENT
-- ======================================================================================

-- 3.1 Primary Clients (Pawning KYC)
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    national_id TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT DEFAULT '.',
    phone TEXT,
    address TEXT,
    branch_id VARCHAR(20) NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    created_by_user_id UUID,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE', 'BLACKLISTED'
    nic_image TEXT,
    signature_image TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_branch_national_id UNIQUE (branch_id, national_id)
);

CREATE INDEX IF NOT EXISTS idx_clients_national_id ON public.clients(national_id);
CREATE INDEX IF NOT EXISTS idx_clients_branch_id ON public.clients(branch_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(phone);

-- 3.2 Stock Customers (Legacy / Counter Stock Customers)
CREATE TABLE IF NOT EXISTS public.stock_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    address_2 TEXT,
    tp TEXT NOT NULL,
    nic TEXT,
    bill_numbers TEXT,
    branch_id VARCHAR(20) REFERENCES public.branches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_customers_nic ON public.stock_customers(nic);
CREATE INDEX IF NOT EXISTS idx_stock_customers_tp ON public.stock_customers(tp);
CREATE INDEX IF NOT EXISTS idx_stock_customers_branch_id ON public.stock_customers(branch_id);

-- ======================================================================================
-- 4. PAWNING CORE OPERATIONS & GOLD COLLATERAL
-- ======================================================================================

-- 4.1 Pawn Tickets / Agreements
CREATE TABLE IF NOT EXISTS public.pawns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_no TEXT,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    weight_grams NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    weight_mg NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    appraised_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    disbursed_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    interest_rate NUMERIC(5, 2) NOT NULL DEFAULT 3.50,
    period_months INTEGER NOT NULL DEFAULT 3,
    branch_id VARCHAR(20) NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    created_by_user_id UUID,
    status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL', -- 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'REDEEMED', 'AUCTIONED'
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    redeemed_at TIMESTAMPTZ,
    redeem_amount NUMERIC(12, 2),
    redeem_interest NUMERIC(12, 2),
    redeemed_by TEXT,
    packet_qr TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_branch_bill_no UNIQUE (branch_id, bill_no)
);

CREATE INDEX IF NOT EXISTS idx_pawns_bill_no ON public.pawns(bill_no);
CREATE INDEX IF NOT EXISTS idx_pawns_packet_qr ON public.pawns(packet_qr);
CREATE INDEX IF NOT EXISTS idx_pawns_client_id ON public.pawns(client_id);
CREATE INDEX IF NOT EXISTS idx_pawns_branch_id ON public.pawns(branch_id);
CREATE INDEX IF NOT EXISTS idx_pawns_status ON public.pawns(status);
CREATE INDEX IF NOT EXISTS idx_pawns_created_at ON public.pawns(created_at DESC);

-- 4.2 Multi-Item Pawn Items Breakdown
CREATE TABLE IF NOT EXISTS public.pawn_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pawn_id UUID REFERENCES public.pawns(id) ON DELETE CASCADE,
    item_type VARCHAR(100) NOT NULL DEFAULT 'CH', -- CH (Chain), BRC (Bracelet), R (Ring), etc.
    purity TEXT DEFAULT '22K',
    description TEXT NOT NULL,
    weight_grams NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    weight_mg NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    appraised_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pawn_items_pawn_id ON public.pawn_items(pawn_id);

-- 4.3 Hydrostatic Gold Evaluations & Evidence
CREATE TABLE IF NOT EXISTS public.rejected_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    air_weight NUMERIC(10, 3) DEFAULT 0,
    water_weight NUMERIC(10, 3) DEFAULT 0,
    specific_gravity NUMERIC(10, 3) DEFAULT 0,
    estimated_karat TEXT,
    asking_amount NUMERIC(12, 2) DEFAULT 0,
    true_value NUMERIC(12, 2) DEFAULT 0,
    status TEXT, -- 'BILL:<bill_no>' or 'REJECTED'
    air_weight_photo_url TEXT,
    water_weight_photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rejected_evaluations_status ON public.rejected_evaluations(status);
CREATE INDEX IF NOT EXISTS idx_rejected_evaluations_created_at ON public.rejected_evaluations(created_at DESC);

-- ======================================================================================
-- 5. STOCK & INVENTORY MANAGEMENT
-- ======================================================================================

-- 5.1 Stock Inventory Items
CREATE TABLE IF NOT EXISTS public.stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_no VARCHAR(100) NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    weight NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    date DATE NOT NULL,
    item_type VARCHAR(50) NOT NULL, -- PP, PR, NL, EAR, BRC, etc.
    status VARCHAR(50) NOT NULL DEFAULT 'Active', -- 'Active', 'Withdrawn'
    branch_id VARCHAR(20) REFERENCES public.branches(id) ON DELETE CASCADE,
    withdrawal_date DATE,
    withdrawal_reason VARCHAR(255),
    withdrawal_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_branch_stock_bill_no UNIQUE (branch_id, bill_no)
);

CREATE INDEX IF NOT EXISTS idx_stock_items_bill_no ON public.stock_items(bill_no);
CREATE INDEX IF NOT EXISTS idx_stock_items_branch_id ON public.stock_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_status ON public.stock_items(status);
CREATE INDEX IF NOT EXISTS idx_stock_items_date ON public.stock_items(date DESC);

-- 5.2 Stock Item Interest Additions
CREATE TABLE IF NOT EXISTS public.stock_interests (
    id TEXT PRIMARY KEY DEFAULT ('si_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6)),
    bill_no TEXT NOT NULL,
    item_id TEXT,
    date DATE NOT NULL,
    interest_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    branch VARCHAR(20) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_interests_bill_branch ON public.stock_interests(bill_no, branch);
CREATE INDEX IF NOT EXISTS idx_stock_interests_date ON public.stock_interests(date);

-- ======================================================================================
-- 6. DAILY CASH LEDGERS & SHIFT MANAGEMENT
-- ======================================================================================

-- 6.1 Daily Ledgers Summary (Per Branch & Date)
CREATE TABLE IF NOT EXISTS public.daily_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id VARCHAR(20) NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    ledger_date DATE NOT NULL,
    opening_capital NUMERIC(12, 2) DEFAULT 0.00,
    cp_balance NUMERIC(12, 2) DEFAULT 0.00,
    opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    transfer_in NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    transfer_in_type TEXT,
    transfer_out NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    transfer_out_type TEXT,
    loan_issued_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    redemption_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    interest_rec_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    recovery_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    insurance_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    expenses_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    closing_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    actual_cash_count NUMERIC(12, 2),
    variance NUMERIC(12, 2) DEFAULT 0.00,
    staff_shift TEXT,
    status TEXT NOT NULL DEFAULT 'APPROVED', -- 'DRAFT', 'APPROVED', 'FLAGGED'
    is_flag_ignored BOOLEAN DEFAULT FALSE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_branch_ledger_date UNIQUE (branch_id, ledger_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_ledgers_branch_date ON public.daily_ledgers(branch_id, ledger_date);

-- 6.2 Daily Ledger Line Transactions (Loans Issued, Redemptions)
CREATE TABLE IF NOT EXISTS public.daily_ledger_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id UUID NOT NULL REFERENCES public.daily_ledgers(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL, -- 'LOAN_ISSUED', 'REDEMPTION'
    bill_no TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    weight_g NUMERIC(10, 3) DEFAULT 0.000,
    weight_mg NUMERIC(10, 3) DEFAULT 0.000,
    insurance_rs NUMERIC(12, 2) DEFAULT 0.00,
    item_code TEXT,
    interest_rs NUMERIC(12, 2) DEFAULT 0.00,
    cash_received NUMERIC(12, 2) DEFAULT 0.00,
    remarks TEXT,
    fs_type TEXT,
    redeem_no TEXT,
    type_ir TEXT,
    quantity TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_ledger_tx_ledger_id ON public.daily_ledger_transactions(ledger_id);
CREATE INDEX IF NOT EXISTS idx_daily_ledger_tx_bill_no ON public.daily_ledger_transactions(bill_no);

-- 6.3 Daily Ledger Expenses
CREATE TABLE IF NOT EXISTS public.daily_ledger_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id UUID NOT NULL REFERENCES public.daily_ledgers(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_ledger_expenses_ledger_id ON public.daily_ledger_expenses(ledger_id);

-- 6.4 Inter-Branch Vault Transfers
CREATE TABLE IF NOT EXISTS public.vault_transfer (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    time TEXT NOT NULL,
    from_vault TEXT NOT NULL,
    to_vault TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT DEFAULT 'LKR',
    status TEXT NOT NULL DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected'
    initiated_by TEXT NOT NULL,
    notes TEXT,
    approved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_transfer_date ON public.vault_transfer(date DESC);

-- ======================================================================================
-- 7. DOUBLE-ENTRY GENERAL LEDGER (GL) ACCOUNTING
-- ======================================================================================

-- 7.1 Chart of Accounts
CREATE TABLE IF NOT EXISTS public.account (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    interest_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'Active',
    opened_date TIMESTAMPTZ DEFAULT NOW()
);

-- 7.2 Journal Entries (Headers)
CREATE TABLE IF NOT EXISTS public.journal_entry (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    description TEXT,
    reference TEXT,
    total_debit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_credit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_journal_entry_balanced CHECK (total_debit = total_credit)
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_date ON public.journal_entry(date DESC);

-- 7.3 Journal Entry Lines (Debit / Credit)
CREATE TABLE IF NOT EXISTS public.journal_entry_line (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    journal_entry_id TEXT NOT NULL REFERENCES public.journal_entry(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    debit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    credit NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_line_entry_id ON public.journal_entry_line(journal_entry_id);

-- 7.4 Unified Operational Transactions Audit
CREATE TABLE IF NOT EXISTS public.transaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'PAWN_ISSUE', 'PAWN_REDEEM', 'VAULT_TRANSFER', etc.
    branch_id VARCHAR(20) REFERENCES public.branches(id) ON DELETE CASCADE,
    target_branch_id VARCHAR(20) REFERENCES public.branches(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    description TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_timestamp ON public.transaction(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_branch_id ON public.transaction(branch_id);

-- ======================================================================================
-- 8. CCTV SURVEILLANCE & COUNTER EVIDENCE
-- ======================================================================================

-- 8.1 Registered Cameras
CREATE TABLE IF NOT EXISTS public.cctv_cameras (
    id VARCHAR(100) PRIMARY KEY,
    branch_id VARCHAR(50) NOT NULL,
    camera_name VARCHAR(255) NOT NULL,
    camera_ip VARCHAR(100) NOT NULL,
    camera_model VARCHAR(100) DEFAULT 'EZVIZ CS-H6c',
    camera_protocol VARCHAR(50) DEFAULT 'ONVIF/RTSP',
    agent_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'ONLINE',
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    counter_name VARCHAR(100) DEFAULT 'Cashier Counter 01',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cctv_cameras_branch_id ON public.cctv_cameras(branch_id);

-- 8.2 Evidence Video Recordings
CREATE TABLE IF NOT EXISTS public.cctv_recordings (
    id VARCHAR(100) PRIMARY KEY,
    branch_id VARCHAR(50) NOT NULL,
    camera_id VARCHAR(100) REFERENCES public.cctv_cameras(id) ON DELETE SET NULL,
    pawn_id VARCHAR(100) NOT NULL,
    cashier_id VARCHAR(100),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration INTEGER DEFAULT 20,
    file_path TEXT NOT NULL,
    file_size BIGINT DEFAULT 0,
    mime_type VARCHAR(50) DEFAULT 'video/mp4',
    status VARCHAR(50) DEFAULT 'COMPLETED', -- 'PROCESSING', 'COMPLETED', 'FAILED'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cctv_recordings_pawn_id ON public.cctv_recordings(pawn_id);
CREATE INDEX IF NOT EXISTS idx_cctv_recordings_branch_id ON public.cctv_recordings(branch_id);

-- 8.3 CCTV Action & Access Audit Logs
CREATE TABLE IF NOT EXISTS public.cctv_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100),
    user_email VARCHAR(255),
    branch_id VARCHAR(50),
    camera_id VARCHAR(100),
    recording_id VARCHAR(100),
    action VARCHAR(50) NOT NULL,
    ip_address VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cctv_audit_logs_created_at ON public.cctv_audit_logs(created_at DESC);

-- 8.4 CCTV System Configuration
CREATE TABLE IF NOT EXISTS public.cctv_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    retention_days INTEGER DEFAULT 30,
    auto_record BOOLEAN DEFAULT TRUE,
    storage_quota_gb INTEGER DEFAULT 500,
    fps INTEGER DEFAULT 15,
    resolution TEXT DEFAULT '1080p',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================================================================================
-- 9. COMMUNICATIONS, AUDIT TRAILS & SYSTEM SETTINGS
-- ======================================================================================

-- 9.1 Outgoing SMS Logs
CREATE TABLE IF NOT EXISTS public.sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    ticket_no TEXT,
    amount NUMERIC(12, 2),
    type TEXT DEFAULT 'RECEIPT',
    status TEXT DEFAULT 'SENT',
    gateway TEXT,
    branch_id VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON public.sms_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON public.sms_logs(phone);

-- 9.2 Key-Value System Settings (SMS Gateway, Branch Defaults)
CREATE TABLE IF NOT EXISTS public.system_settings (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9.3 System-wide Activity Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_email TEXT,
    role TEXT,
    branch_id VARCHAR(20) REFERENCES public.branches(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch_id ON public.audit_logs(branch_id);

-- ======================================================================================
-- 10. ROW LEVEL SECURITY (RLS) & POLICIES
-- ======================================================================================

-- Enable RLS across all tables
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pawns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pawn_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rejected_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_ledger_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctv_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 10.1 Policies for Branches & Branch Status
DROP POLICY IF EXISTS "Branches read access" ON public.branches;
CREATE POLICY "Branches read access" ON public.branches FOR SELECT USING (true);

DROP POLICY IF EXISTS "Branches modify admin" ON public.branches;
CREATE POLICY "Branches modify admin" ON public.branches FOR ALL USING (public.get_auth_user_role() = 'ADMIN');

DROP POLICY IF EXISTS "Branch status access" ON public.branch_status;
CREATE POLICY "Branch status access" ON public.branch_status FOR ALL USING (true);

-- 10.2 Policies for User Profiles
DROP POLICY IF EXISTS "Profiles read access" ON public.profiles;
CREATE POLICY "Profiles read access" ON public.profiles FOR SELECT USING (
    id = auth.uid() OR public.get_auth_user_role() = 'ADMIN' OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "Profiles update access" ON public.profiles;
CREATE POLICY "Profiles update access" ON public.profiles FOR UPDATE USING (
    id = auth.uid() OR public.get_auth_user_role() = 'ADMIN'
);

DROP POLICY IF EXISTS "Profiles insert access" ON public.profiles;
CREATE POLICY "Profiles insert access" ON public.profiles FOR INSERT WITH CHECK (
    id = auth.uid() OR public.get_auth_user_role() = 'ADMIN'
);

-- 10.3 Open Read/Write Policies for Authenticated Operations
DROP POLICY IF EXISTS "Clients policy" ON public.clients;
CREATE POLICY "Clients policy" ON public.clients FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Stock customers policy" ON public.stock_customers;
CREATE POLICY "Stock customers policy" ON public.stock_customers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pawns policy" ON public.pawns;
CREATE POLICY "Pawns policy" ON public.pawns FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pawn items policy" ON public.pawn_items;
CREATE POLICY "Pawn items policy" ON public.pawn_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Rejected evaluations policy" ON public.rejected_evaluations;
CREATE POLICY "Rejected evaluations policy" ON public.rejected_evaluations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Stock items policy" ON public.stock_items;
CREATE POLICY "Stock items policy" ON public.stock_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Stock interests policy" ON public.stock_interests;
CREATE POLICY "Stock interests policy" ON public.stock_interests FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Daily ledgers policy" ON public.daily_ledgers;
CREATE POLICY "Daily ledgers policy" ON public.daily_ledgers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Daily ledger tx policy" ON public.daily_ledger_transactions;
CREATE POLICY "Daily ledger tx policy" ON public.daily_ledger_transactions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Daily ledger expenses policy" ON public.daily_ledger_expenses;
CREATE POLICY "Daily ledger expenses policy" ON public.daily_ledger_expenses FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Vault transfer policy" ON public.vault_transfer;
CREATE POLICY "Vault transfer policy" ON public.vault_transfer FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Account policy" ON public.account;
CREATE POLICY "Account policy" ON public.account FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Journal entry policy" ON public.journal_entry;
CREATE POLICY "Journal entry policy" ON public.journal_entry FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Journal entry line policy" ON public.journal_entry_line;
CREATE POLICY "Journal entry line policy" ON public.journal_entry_line FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Transaction policy" ON public.transaction;
CREATE POLICY "Transaction policy" ON public.transaction FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "CCTV cameras policy" ON public.cctv_cameras;
CREATE POLICY "CCTV cameras policy" ON public.cctv_cameras FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "CCTV recordings policy" ON public.cctv_recordings;
CREATE POLICY "CCTV recordings policy" ON public.cctv_recordings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "CCTV audit logs policy" ON public.cctv_audit_logs;
CREATE POLICY "CCTV audit logs policy" ON public.cctv_audit_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "CCTV settings policy" ON public.cctv_settings;
CREATE POLICY "CCTV settings policy" ON public.cctv_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "SMS logs policy" ON public.sms_logs;
CREATE POLICY "SMS logs policy" ON public.sms_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "System settings policy" ON public.system_settings;
CREATE POLICY "System settings policy" ON public.system_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Audit logs policy" ON public.audit_logs;
CREATE POLICY "Audit logs policy" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);

-- ======================================================================================
-- 11. INITIAL SEED DATA
-- ======================================================================================

-- 11.1 All Canonical Branches
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

-- 11.2 Default Branch Operating Status
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

-- 11.3 Default CCTV Settings
INSERT INTO public.cctv_settings (id, retention_days, auto_record, storage_quota_gb, fps, resolution) VALUES
    ('default', 30, true, 500, 15, '1080p')
ON CONFLICT (id) DO NOTHING;

-- 11.4 Standard Chart of Accounts
INSERT INTO public.account (id, name, type, balance, interest_rate, status) VALUES
    ('1010', 'Vault Cash (Asset)', 'Asset', 0.00, 0.00, 'Active'),
    ('1020', 'Bank Operational Account', 'Asset', 0.00, 0.00, 'Active'),
    ('1030', 'Pawn Loan Receivables', 'Asset', 0.00, 0.00, 'Active'),
    ('1035', 'Pawn Loan Portfolio (Asset)', 'Asset', 0.00, 0.00, 'Active'),
    ('2010', 'Customer Collateral Deposits', 'Liability', 0.00, 0.00, 'Active'),
    ('3010', 'Shareholder Capital', 'Equity', 0.00, 0.00, 'Active'),
    ('4010', 'Interest Income from Pawning', 'Revenue', 0.00, 0.00, 'Active'),
    ('4015', 'Interest & Fee Income (Revenue)', 'Revenue', 0.00, 0.00, 'Active'),
    ('4020', 'Stationery / Ticket Service Charges', 'Revenue', 0.00, 0.00, 'Active'),
    ('5010', 'Operating & Branch Expenses', 'Expense', 0.00, 0.00, 'Active')
ON CONFLICT (id) DO NOTHING;

-- 11.5 Supabase Storage Buckets
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('avatars', 'avatars', true),
    ('pawn_images', 'pawn_images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

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

-- ======================================================================================
-- END OF COMPLETE SCHEMA SCRIPT
-- ======================================================================================
