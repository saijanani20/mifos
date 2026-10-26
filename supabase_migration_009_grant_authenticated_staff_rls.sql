-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 009: GRANT AUTHENTICATED STAFF RLS ACCESS
-- ================================================================================
-- Purpose: Enable proper authenticated access for Tellers, Managers, Auditors & Admins
-- across core operational tables (pawns, clients, pawn_items, transactions, ledger, branch_status)
-- while keeping public/anonymous access completely blocked.
-- ================================================================================

-- 1. BRANCHES (Public read for login dropdown + authenticated operations)
DROP POLICY IF EXISTS "authenticated read branches" ON public.branches;
DROP POLICY IF EXISTS "Branches read access" ON public.branches;
CREATE POLICY "Branches read access" ON public.branches
FOR SELECT USING (is_active = true);

-- 2. BRANCH STATUS (Read for all, modify for staff)
DROP POLICY IF EXISTS "Branch status access" ON public.branch_status;
CREATE POLICY "Branch status read access" ON public.branch_status
FOR SELECT USING (true);

CREATE POLICY "Branch status modify access" ON public.branch_status
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. PROFILES (Authenticated staff can read profile names, users can update own)
DROP POLICY IF EXISTS "profiles read own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles read access" ON public.profiles;
CREATE POLICY "Profiles read access" ON public.profiles
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update access" ON public.profiles;
CREATE POLICY "Profiles update access" ON public.profiles
FOR UPDATE TO authenticated 
USING (id = auth.uid() OR public.get_auth_user_role() = 'ADMIN') 
WITH CHECK (id = auth.uid() OR public.get_auth_user_role() = 'ADMIN');

DROP POLICY IF EXISTS "Profiles insert access" ON public.profiles;
CREATE POLICY "Profiles insert access" ON public.profiles
FOR INSERT TO authenticated 
WITH CHECK (id = auth.uid() OR public.get_auth_user_role() = 'ADMIN');

-- 4. CLIENTS (KYC Management - Tellers & Staff)
DROP POLICY IF EXISTS "Clients authenticated policy" ON public.clients;
CREATE POLICY "Clients authenticated policy" ON public.clients
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. STOCK CUSTOMERS (Legacy KYC lookup)
DROP POLICY IF EXISTS "Stock customers authenticated policy" ON public.stock_customers;
CREATE POLICY "Stock customers authenticated policy" ON public.stock_customers
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. PAWNS (Core Pawning Tickets)
DROP POLICY IF EXISTS "Pawns authenticated policy" ON public.pawns;
CREATE POLICY "Pawns authenticated policy" ON public.pawns
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. PAWN ITEMS (Collateral breakdown)
DROP POLICY IF EXISTS "Pawn items authenticated policy" ON public.pawn_items;
CREATE POLICY "Pawn items authenticated policy" ON public.pawn_items
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. TRANSACTIONS (Interest payments, redemptions, loan issues)
DROP POLICY IF EXISTS "Transactions authenticated policy" ON public.transaction;
CREATE POLICY "Transactions authenticated policy" ON public.transaction
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 9. ACCOUNT (Chart of Accounts read access)
DROP POLICY IF EXISTS "Account authenticated policy" ON public.account;
CREATE POLICY "Account authenticated policy" ON public.account
FOR SELECT TO authenticated USING (true);

-- 10. DAILY LEDGERS & CASH MANAGEMENT
DROP POLICY IF EXISTS "Daily ledgers authenticated policy" ON public.daily_ledgers;
CREATE POLICY "Daily ledgers authenticated policy" ON public.daily_ledgers
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Daily ledger tx authenticated policy" ON public.daily_ledger_transactions;
CREATE POLICY "Daily ledger tx authenticated policy" ON public.daily_ledger_transactions
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Daily ledger exp authenticated policy" ON public.daily_ledger_expenses;
CREATE POLICY "Daily ledger exp authenticated policy" ON public.daily_ledger_expenses
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 11. STOCK MANAGEMENT
DROP POLICY IF EXISTS "Stock items authenticated policy" ON public.stock_items;
CREATE POLICY "Stock items authenticated policy" ON public.stock_items
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Stock interests authenticated policy" ON public.stock_interests;
CREATE POLICY "Stock interests authenticated policy" ON public.stock_interests
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 12. GENERAL LEDGER & VAULT TRANSFERS
DROP POLICY IF EXISTS "Vault transfer authenticated policy" ON public.vault_transfer;
CREATE POLICY "Vault transfer authenticated policy" ON public.vault_transfer
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Journal entry authenticated policy" ON public.journal_entry;
CREATE POLICY "Journal entry authenticated policy" ON public.journal_entry
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Journal line authenticated policy" ON public.journal_entry_line;
CREATE POLICY "Journal line authenticated policy" ON public.journal_entry_line
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 13. CCTV & SYSTEM LOGS
DROP POLICY IF EXISTS "CCTV cameras authenticated policy" ON public.cctv_cameras;
CREATE POLICY "CCTV cameras authenticated policy" ON public.cctv_cameras
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "CCTV recordings authenticated policy" ON public.cctv_recordings;
CREATE POLICY "CCTV recordings authenticated policy" ON public.cctv_recordings
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "CCTV audit logs authenticated policy" ON public.cctv_audit_logs;
CREATE POLICY "CCTV audit logs authenticated policy" ON public.cctv_audit_logs
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "SMS logs authenticated policy" ON public.sms_logs;
CREATE POLICY "SMS logs authenticated policy" ON public.sms_logs
FOR ALL TO authenticated USING (true) WITH CHECK (true);
