'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle 
} from '@/components/ui/dialog';
import { 
  ShieldCheck, Search, Filter, RefreshCcw, Camera, Eye, 
  CheckCircle2, AlertTriangle, Clock, Building2, User, UserCheck,
  Calendar, DollarSign, Scale, FileText, Check, AlertCircle,
  HelpCircle, Sparkles, ChevronRight, X,
  RotateCcw, Zap, Database, Package, Loader2, ExternalLink, Download,
  QrCode, Tag
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { cn } from '@/lib/utils';
import PacketQrScannerModal from '@/components/PacketQrScannerModal';

interface PawnItem {
  id: string;
  item_type: string;
  purity?: string;
  weight_grams?: number;
  weight_mg?: number;
  appraised_value?: number;
  description?: string;
}

interface PawnTransaction {
  id: string;
  bill_no: string;
  client_id: string;
  customer_name?: string;
  phone?: string;
  clients?: {
    first_name?: string;
    last_name?: string;
    national_id?: string;
    phone?: string;
    address?: string;
    nic_image?: string;
    signature_image?: string;
  };
  disbursed_amount: number;
  appraised_value: number;
  interest_rate: number;
  period_months: number;
  weight_grams?: number;
  weight_mg?: number;
  weight?: number;
  status: string;
  branch_id: string;
  created_at: string;
  description?: string;
  air_weight_photo_url?: string;
  water_weight_photo_url?: string;
  evaluation_air_weight?: number;
  evaluation_water_weight?: number;
  packet_qr?: string;
  items?: PawnItem[];
}

interface AuditRecord {
  id?: string;
  bill_no: string;
  status: 'PASSED' | 'FLAGGED' | 'IN_REVIEW';
  notes: string;
  auditor_email: string;
  audited_at: string;
}

export default function AuditorDashboard() {
  const [pawns, setPawns] = useState<PawnTransaction[]>([]);
  const [auditMap, setAuditMap] = useState<Record<string, AuditRecord>>({});
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'ALL' | 'PENDING' | 'PASSED' | 'FLAGGED'>('ALL');
  const [pawnStatusFilter, setPawnStatusFilter] = useState<'ALL' | 'ACTIVE' | 'AUDITED_PENDING_APPROVAL' | 'PENDING_APPROVAL' | 'REQUIRES_RECHECK' | 'REDEEMED'>('ALL');

  // Modal State
  const [selectedPawn, setSelectedPawn] = useState<PawnTransaction | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditDecision, setAuditDecision] = useState<'PASSED' | 'FLAGGED' | 'IN_REVIEW'>('PASSED');
  const [auditNotes, setAuditNotes] = useState('');
  const [isSavingAudit, setIsSavingAudit] = useState(false);

  // Packet Sticker QR Scanner State
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerTargetPawn, setScannerTargetPawn] = useState<PawnTransaction | null>(null);
  const [packetFilter, setPacketFilter] = useState<'ALL' | 'ATTACHED' | 'MISSING'>('ALL');

  // View & Redis Inventory Cache State
  const [activeTab, setActiveTab] = useState<'pawns' | 'inventory'>('pawns');
  const [forceExpireCache, setForceExpireCache] = useState<boolean>(false);
  const [isInvalidatingCache, setIsInvalidatingCache] = useState<boolean>(false);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [loadingInventory, setLoadingInventory] = useState<boolean>(false);
  const [inventoryCacheStatus, setInventoryCacheStatus] = useState<'HIT' | 'MISS' | null>(null);
  const [inventoryDate, setInventoryDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [inventorySearch, setInventorySearch] = useState<string>('');

  // Load User & Pawn Data
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const stored = localStorage.getItem('user');
      const u = stored ? JSON.parse(stored) : null;
      setUser(u);

      // 1. Fetch pawns: Auditors can access ALL branches including Head Office, or filter by selected branch
      const params = new URLSearchParams({
        filterBranch: selectedBranch,
        role: u?.role || 'AUDITOR'
      });
      const pawnsRes = await fetch(`/api/pawns?${params}`, {
        headers: getAuthHeaders()
      });

      if (!pawnsRes.ok) {
        throw new Error('Failed to load transactions');
      }
      const pawnsData: PawnTransaction[] = await pawnsRes.json();
      setPawns(Array.isArray(pawnsData) ? pawnsData : []);

      // 2. Fetch existing audit logs to map verified/flagged transactions
      const logParams = new URLSearchParams({
        action: 'AUDIT_',
        branchId: selectedBranch === 'ALL' ? 'ALL' : selectedBranch
      });
      const logsRes = await fetch(`/api/audit-logs?${logParams}`, {
        headers: getAuthHeaders()
      });

      if (logsRes.ok) {
        const logsJson = await logsRes.json();
        const logs = logsJson.logs || [];
        const newAuditMap: Record<string, AuditRecord> = {};

        logs.forEach((log: any) => {
          const bill = log.resource || log.details?.bill_no;
          if (bill && !newAuditMap[bill]) {
            let st: 'PASSED' | 'FLAGGED' | 'IN_REVIEW' = 'IN_REVIEW';
            if (log.action === 'AUDIT_VERIFIED' || log.action === 'AUDITOR_APPROVED') st = 'PASSED';
            else if (log.action === 'AUDIT_FLAGGED' || log.action === 'AUDIT_ISSUE_RAISED') st = 'FLAGGED';

            newAuditMap[bill] = {
              id: log.id,
              bill_no: bill,
              status: log.details?.status === 'AUDITED_PENDING_APPROVAL' ? 'PASSED' : log.details?.status || st,
              notes: log.details?.notes || '',
              auditor_email: log.user_email || 'Auditor',
              audited_at: log.created_at
            };
          }
        });
        setAuditMap(newAuditMap);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error loading auditor dashboard');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Inventory Matrix with Redis Caching and Auditor Force-Expiry
  const fetchInventoryData = async (forceInvalidate = false) => {
    setLoadingInventory(true);
    let toastId: any = null;
    if (forceInvalidate) {
      setIsInvalidatingCache(true);
      toastId = toast.loading(`Invalidating Redis cache for branch "${selectedBranch}"...`);
    }
    try {
      if (forceInvalidate) {
        const token = localStorage.getItem('auth_token') || '';
        const invRes = await fetch('/api/stock/cache/invalidate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            branch: selectedBranch || 'ALL',
            date: inventoryDate
          })
        });

        if (!invRes.ok) {
          const errJson = await invRes.json();
          throw new Error(errJson.error || 'Failed to invalidate Redis cache');
        }
      }

      // Fetch from /api/stock/daily-matrix (uses cache by default unless just invalidated)
      const token = localStorage.getItem('auth_token') || '';
      const params = new URLSearchParams({
        date: inventoryDate,
        branch: selectedBranch || 'ALL'
      });
      const res = await fetch(`/api/stock/daily-matrix?${params}`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (res.ok) {
        const cacheHeader = res.headers.get('X-Cache');
        setInventoryCacheStatus(cacheHeader === 'HIT' ? 'HIT' : 'MISS');
        const data = await res.json();
        setInventoryData(data);

        if (forceInvalidate && toastId) {
          toast.success(`Redis cache force-expired for ${selectedBranch}. Fresh inventory reloaded from database.`, { id: toastId });
        }
      }
    } catch (err: any) {
      console.error('Inventory load error:', err);
      if (forceInvalidate && toastId) {
        toast.error(err.message || 'Failed to invalidate cache', { id: toastId });
      }
    } finally {
      setLoadingInventory(false);
      setIsInvalidatingCache(false);
    }
  };

  // Reload handler: Uses cache by default, or force expires if Auditor checked the box
  const handleReload = async () => {
    if (forceExpireCache) {
      await fetchInventoryData(true);
      await loadDashboardData();
    } else {
      await Promise.all([
        loadDashboardData(),
        fetchInventoryData(false)
      ]);
      toast.success(`Auditor dashboard reloaded (${inventoryCacheStatus === 'HIT' ? 'using Redis cache' : 'fresh data fetched'})`);
    }
  };

  useEffect(() => {
    loadDashboardData();
    fetchInventoryData(false);
  }, [selectedBranch, inventoryDate]);

  // Combined and filtered inventory items for the Inventory Section
  const inventoryItems = useMemo(() => {
    if (!inventoryData?.data) return [];
    const { fs_items = [], interest_items = [], receipt_items = [], loan_items = [], redeem_items = [] } = inventoryData.data;
    const combined = [
      ...fs_items.map((i: any) => ({ ...i, type: 'Full Settlement (F/S)', badgeColor: 'bg-blue-100 text-blue-800 border-blue-300' })),
      ...interest_items.map((i: any) => ({ ...i, type: 'Stock Interest', badgeColor: 'bg-amber-100 text-amber-800 border-amber-300' })),
      ...receipt_items.map((i: any) => ({ ...i, type: 'Daily Receipt', badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300' })),
      ...loan_items.map((i: any) => ({ ...i, type: 'Pawn Loan', badgeColor: 'bg-purple-100 text-purple-800 border-purple-300' })),
      ...redeem_items.map((i: any) => ({ ...i, type: 'Redemption', badgeColor: 'bg-rose-100 text-rose-800 border-rose-300' })),
    ];
    if (!inventorySearch) return combined;
    const q = inventorySearch.toLowerCase();
    return combined.filter((i: any) => 
      (i.bill_no && i.bill_no.toLowerCase().includes(q)) ||
      (i.notes && i.notes.toLowerCase().includes(q)) ||
      (i.branch && i.branch.toLowerCase().includes(q)) ||
      (i.type && i.type.toLowerCase().includes(q))
    );
  }, [inventoryData, inventorySearch]);

  // Filtered Pawns
  const filteredPawns = useMemo(() => {
    return pawns.filter((p) => {
      // Branch Filter
      if (selectedBranch !== 'ALL') {
        const b = (p.branch_id || '').toUpperCase().trim();
        const sel = selectedBranch.toUpperCase().trim();
        if (b !== sel && !b.includes(sel)) return false;
      }

      // 1. Search Query (Bill No, Customer Name, NIC, Phone)
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const bill = (p.bill_no || '').toLowerCase();
        const cust = (p.clients?.first_name || p.customer_name || '').toLowerCase();
        const nic = (p.clients?.national_id || '').toLowerCase();
        const phone = (p.clients?.phone || p.phone || '').toLowerCase();
        const matches = bill.includes(q) || cust.includes(q) || nic.includes(q) || phone.includes(q);
        if (!matches) return false;
      }

      // 2. Audit Status Filter
      const auditRec = auditMap[p.bill_no];
      const currentAuditStatus = auditRec ? auditRec.status : 'PENDING';
      if (auditStatusFilter !== 'ALL' && currentAuditStatus !== auditStatusFilter) {
        return false;
      }

      // 3. Pawn Status Filter
      if (pawnStatusFilter !== 'ALL' && p.status !== pawnStatusFilter) {
        return false;
      }

      // 4. Packet Sticker Filter
      if (packetFilter === 'ATTACHED' && !p.packet_qr) {
        return false;
      }
      if (packetFilter === 'MISSING' && p.packet_qr) {
        return false;
      }

      return true;
    });
  }, [pawns, auditMap, searchQuery, auditStatusFilter, pawnStatusFilter, selectedBranch, packetFilter]);

  // Summary Metrics
  const stats = useMemo(() => {
    const total = pawns.length;
    let pending = 0;
    let passed = 0;
    let flagged = 0;
    let totalPortfolioAudited = 0;
    let stickeredCount = 0;
    let missingStickerCount = 0;

    pawns.forEach((p) => {
      if (p.packet_qr) {
        stickeredCount++;
      } else {
        missingStickerCount++;
      }

      const rec = auditMap[p.bill_no];
      if (!rec) {
        pending++;
      } else if (rec.status === 'PASSED') {
        passed++;
        totalPortfolioAudited += Number(p.disbursed_amount) || 0;
      } else if (rec.status === 'FLAGGED') {
        flagged++;
      } else {
        pending++;
      }
    });

    return { total, pending, passed, flagged, totalPortfolioAudited, stickeredCount, missingStickerCount };
  }, [pawns, auditMap]);

  // Open Audit Review Modal
  const handleOpenAuditModal = (pawn: PawnTransaction) => {
    setSelectedPawn(pawn);
    const existing = auditMap[pawn.bill_no];
    if (existing) {
      setAuditDecision(existing.status);
      setAuditNotes(existing.notes || '');
    } else {
      setAuditDecision('PASSED');
      setAuditNotes('');
    }
    setIsAuditModalOpen(true);
  };

  // Save Audit Verification / Flag
  const handleSaveAudit = async () => {
    if (!selectedPawn) return;
    setIsSavingAudit(true);
    const toastId = toast.loading('Recording audit observation...');

    try {
      const actionName = auditDecision === 'PASSED' ? 'AUDIT_VERIFIED' : 'AUDIT_FLAGGED';

      const res = await fetch('/api/audit-logs', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: actionName,
          resource: selectedPawn.bill_no,
          bill_no: selectedPawn.bill_no,
          branch_id: selectedPawn.branch_id,
          details: {
            bill_no: selectedPawn.bill_no,
            pawn_id: selectedPawn.id,
            status: auditDecision,
            notes: auditNotes,
            disbursed_amount: selectedPawn.disbursed_amount,
            audited_at: new Date().toISOString(),
            auditor_email: user?.email || 'Branch Auditor'
          }
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save audit record');
      }

      // Update local state map
      setAuditMap((prev) => ({
        ...prev,
        [selectedPawn.bill_no]: {
          bill_no: selectedPawn.bill_no,
          status: auditDecision,
          notes: auditNotes,
          auditor_email: user?.email || 'Branch Auditor',
          audited_at: new Date().toISOString()
        }
      }));

      toast.success(
        auditDecision === 'PASSED' 
          ? `Bill #${selectedPawn.bill_no} marked as Verified` 
          : `Bill #${selectedPawn.bill_no} flagged with discrepancy`,
        { id: toastId }
      );
      setIsAuditModalOpen(false);
    } catch (err: any) {
      toast.error('Audit save failed', { description: err.message, id: toastId });
    } finally {
      setIsSavingAudit(false);
    }
  };

  // Robust Cross-Browser CSV Downloader using Blob
  const triggerCSVDownload = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escapeCell = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/\r\n|\r|\n/g, ' '); // flatten newlines inside cell for clean row display
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvLines = [
      headers.map(escapeCell).join(','),
      ...rows.map(row => row.map(escapeCell).join(','))
    ];

    const csvString = csvLines.join('\r\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 500);
  };

  // Export Auditor Report (CSV) with Audit History & Verifier Info
  const handleExportAuditReport = () => {
    if (filteredPawns.length === 0) {
      toast.error('No audit records available to export for current filter criteria.');
      return;
    }

    const headers = [
      'Bill Ticket No',
      'Branch',
      'Created Date',
      'Customer Name',
      'Customer NIC',
      'Customer Phone',
      'Disbursed Amount (LKR)',
      'Appraised Value (LKR)',
      'Interest Rate (%)',
      'Period (Months)',
      'Collateral Description',
      'Weight (g)',
      'Scale Air Proof',
      'Scale Water Proof',
      'NIC Front KYC',
      'NIC Back KYC',
      'Signature KYC',
      'Loan Status',
      'Audit Status',
      'Audited By (Who Did Audit)',
      'Audited Date & Time',
      'Auditor Observation Notes'
    ];

    const rows = filteredPawns.map((pawn) => {
      const rec = auditMap[pawn.bill_no];
      
      let nicFrontStatus = 'Missing';
      let nicBackStatus = 'Missing';
      if (pawn.clients?.nic_image) {
        try {
          const parsed = JSON.parse(pawn.clients.nic_image);
          if (parsed.front) nicFrontStatus = 'Captured';
          if (parsed.back) nicBackStatus = 'Captured';
        } catch {
          if (pawn.clients.nic_image) nicFrontStatus = 'Captured';
        }
      }
      const sigStatus = pawn.clients?.signature_image ? 'Captured' : 'Missing';
      const weightGrams = ((pawn.weight_mg || 0) / 1000 || pawn.weight_grams || pawn.weight || 0).toFixed(2);

      return [
        pawn.bill_no || pawn.id,
        pawn.branch_id || 'HQ',
        pawn.created_at ? new Date(pawn.created_at).toLocaleString('en-GB') : '',
        pawn.clients?.first_name || pawn.customer_name || 'Customer',
        pawn.clients?.national_id || 'N/A',
        pawn.clients?.phone || pawn.phone || 'N/A',
        pawn.disbursed_amount || 0,
        pawn.appraised_value || 0,
        pawn.interest_rate || 0,
        pawn.period_months || 0,
        pawn.description || '',
        weightGrams,
        pawn.air_weight_photo_url ? 'Attached' : 'None',
        pawn.water_weight_photo_url ? 'Attached' : 'None',
        nicFrontStatus,
        nicBackStatus,
        sigStatus,
        pawn.status,
        rec ? (rec.status === 'PASSED' ? 'VERIFIED' : rec.status) : 'PENDING_AUDIT',
        rec?.auditor_email || 'Not Audited',
        rec?.audited_at ? new Date(rec.audited_at).toLocaleString('en-GB') : 'N/A',
        rec?.notes || ''
      ];
    });

    const branchName = selectedBranch === 'ALL' ? 'All_Branches' : selectedBranch.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Auditor_Report_${branchName}_${new Date().toISOString().split('T')[0]}.csv`;
    triggerCSVDownload(filename, headers, rows);
    toast.success(`Auditor Report exported successfully as CSV (${filteredPawns.length} records)`);
  };

  // Export Vault Inventory Report (CSV)
  const handleExportInventoryReport = () => {
    if (!inventoryItems || inventoryItems.length === 0) {
      toast.error('No inventory items to export.');
      return;
    }

    const headers = [
      'Ticket / Bill No',
      'Branch',
      'Inventory Category',
      'Item Description',
      'Purity / Karat',
      'Weight (g)',
      'Weight (mg)',
      'Valuation (LKR)',
      'Status',
      'Record Date'
    ];

    const rows = inventoryItems.map((item: any) => [
      item.bill_no || item.ticket_no || 'N/A',
      item.branch_id || selectedBranch || 'HQ',
      item.source_type || 'Collateral Vault',
      item.description || item.item_type || '',
      item.purity || '22K',
      ((item.weight_mg || 0) / 1000 || item.weight_grams || 0).toFixed(2),
      item.weight_mg || 0,
      item.appraised_value || 0,
      item.status || 'IN_VAULT',
      inventoryDate
    ]);

    const branchName = (selectedBranch || 'ALL').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Inventory_Report_${branchName}_${inventoryDate}.csv`;
    triggerCSVDownload(filename, headers, rows);
    toast.success(`Inventory Report exported successfully as CSV (${inventoryItems.length} items)`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner */}
      <div className="glass p-6 sm:p-8 rounded-3xl border border-amber-500/20 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative overflow-hidden bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] uppercase tracking-widest px-3 py-0.5 rounded-full border-transparent shadow-sm">
              <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Auditor Portal
            </Badge>
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-amber-600" />
              Scope: <strong className="text-slate-900 font-black">{selectedBranch === 'ALL' ? 'All Branches (incl. Head Office)' : selectedBranch}</strong>
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Pawn <span className="text-amber-600">Audit Dashboard</span>
          </h1>
          <p className="text-slate-600 text-sm font-semibold max-w-2xl">
            Audit and verify collateral weights, loan amounts, scale photographic proofs, and loan tickets across all operating branches and Head Office.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Redis Cache Status Pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white/90 shadow-xs text-[11px] font-bold">
            <Database className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="text-slate-500">Cache:</span>
            {inventoryCacheStatus === 'HIT' ? (
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md font-black flex items-center gap-1 text-[10px]">
                <Zap className="w-3 h-3 text-emerald-600" /> HIT (Redis L1)
              </span>
            ) : inventoryCacheStatus === 'MISS' ? (
              <span className="text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-md font-black text-[10px]">
                MISS (PostgreSQL)
              </span>
            ) : (
              <span className="text-slate-600 font-mono text-[10px]">READY</span>
            )}
          </div>

          {/* Auditor Check Button to reset/force expire Redis cache */}
          <label 
            className={cn(
              "flex items-center gap-2 cursor-pointer border px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all select-none shadow-xs h-11",
              forceExpireCache 
                ? "bg-amber-500 border-amber-600 text-slate-950 shadow-amber-500/20 ring-2 ring-amber-500/30" 
                : "bg-amber-50/90 hover:bg-amber-100 border-amber-200/90 text-amber-900"
            )}
            title="Check button to reset/force expire the Redis cache of the inventory on reload"
          >
            <input
              type="checkbox"
              checked={forceExpireCache}
              onChange={(e) => setForceExpireCache(e.target.checked)}
              className="w-4 h-4 accent-amber-600 rounded cursor-pointer"
            />
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Force Expire Cache
            </span>
          </label>

          {/* Reload Button (Uses Cache by Default) */}
          <Button
            variant="outline"
            onClick={handleReload}
            disabled={loading || loadingInventory || isInvalidatingCache}
            className={cn(
              "h-11 px-5 border-slate-200 bg-white/90 hover:bg-slate-100 text-slate-800 font-black text-xs uppercase tracking-wider rounded-xl gap-2 shadow-xs cursor-pointer transition-all",
              forceExpireCache && "border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 text-amber-950 font-black"
            )}
            title={forceExpireCache ? "Reload and force-expire Redis inventory cache" : "Reload using Redis cache by default"}
          >
            {(loading || loadingInventory || isInvalidatingCache) ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
            ) : (
              <RotateCcw className="w-4 h-4 text-slate-700" />
            )}
            {forceExpireCache ? 'Force Reload' : 'Reload'}
          </Button>

          {/* Scan Vault Packet QR Button */}
          <Button
            onClick={() => {
              setScannerTargetPawn(null);
              setIsScannerOpen(true);
            }}
            className="h-11 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-xs uppercase tracking-wider rounded-xl gap-2 shadow-lg shadow-amber-500/25 cursor-pointer transition-all border-none"
            title="Scan Vault Packet Sticker QR code with live camera or barcode gun"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan Packet QR</span>
          </Button>

          {/* Export Report (CSV) Button */}
          <Button
            variant="outline"
            onClick={activeTab === 'inventory' ? handleExportInventoryReport : handleExportAuditReport}
            className="h-11 px-4 border-slate-200 bg-white/90 hover:bg-slate-100 text-slate-800 font-black text-xs uppercase tracking-wider rounded-xl gap-2 shadow-xs cursor-pointer transition-all"
            title="Export filtered records as CSV audit report"
          >
            <Download className="w-4 h-4 text-amber-600" />
            <span>Export Report (CSV)</span>
          </Button>

          {/* Link to Full Activity Audit Trail */}
          <Link href="/operations/audit-logs">
            <Button
              variant="outline"
              className="h-11 px-4 border-slate-200 bg-white/90 hover:bg-slate-100 text-slate-800 font-black text-xs uppercase tracking-wider rounded-xl gap-1.5 shadow-xs cursor-pointer transition-all"
              title="Open system-wide activity audit logs trail"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              <span>Audit Trail</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="glass border-white/40 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Total Branch Tickets</span>
            <FileText className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3">
            <p className="text-3xl font-black text-slate-900 tracking-tight">{loading ? '—' : stats.total}</p>
            <p className="text-[11px] text-slate-500 font-semibold mt-0.5">Tickets in assigned branch</p>
          </div>
        </div>

        <div className="glass border-amber-500/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between bg-amber-500/5">
          <div className="flex items-center justify-between text-amber-600">
            <span className="text-[10px] font-black uppercase tracking-widest">Pending Audit</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-3">
            <p className="text-3xl font-black text-amber-600 tracking-tight">{loading ? '—' : stats.pending}</p>
            <p className="text-[11px] text-amber-700/80 font-semibold mt-0.5">Requires audit review</p>
          </div>
        </div>

        <div className="glass border-emerald-500/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between bg-emerald-500/5">
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-[10px] font-black uppercase tracking-widest">Passed & Verified</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3">
            <p className="text-3xl font-black text-emerald-600 tracking-tight">{loading ? '—' : stats.passed}</p>
            <p className="text-[11px] text-emerald-700/80 font-semibold mt-0.5">Verified without issue</p>
          </div>
        </div>

        <div className="glass border-rose-500/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between bg-rose-500/5">
          <div className="flex items-center justify-between text-rose-600">
            <span className="text-[10px] font-black uppercase tracking-widest">Flagged Discrepancies</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-3">
            <p className="text-3xl font-black text-rose-600 tracking-tight">{loading ? '—' : stats.flagged}</p>
            <p className="text-[11px] text-rose-700/80 font-semibold mt-0.5">Flagged for investigation</p>
          </div>
        </div>

        <div className="glass border-blue-500/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between bg-blue-500/5 col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-blue-600">
            <span className="text-[10px] font-black uppercase tracking-widest">Verified Portfolio</span>
            <DollarSign className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-3">
            <p className="text-2xl font-black text-blue-700 tracking-tight font-mono">
              {loading ? '—' : `Rs. ${(stats.totalPortfolioAudited / 1000).toFixed(1)}k`}
            </p>
            <p className="text-[11px] text-blue-600 font-semibold mt-0.5">Total audited value</p>
          </div>
        </div>
      </div>

      {/* View Switcher: Pawn Loans Audit vs Vault Inventory & Redis Cache */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-3">
        <div className="flex items-center gap-2 bg-slate-100/90 p-1.5 rounded-2xl">
          <button
            type="button"
            onClick={() => setActiveTab('pawns')}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
              activeTab === 'pawns'
                ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Scale className="w-4 h-4 text-amber-600" />
            Pawn Transactions Audit
            <Badge variant="outline" className="ml-1 text-[10px] font-mono font-bold">
              {filteredPawns.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
              activeTab === 'inventory'
                ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Package className="w-4 h-4 text-amber-600" />
            Inventory List &amp; Redis Cache
            <Badge variant="outline" className="ml-1 text-[10px] font-mono font-bold bg-amber-50 text-amber-800 border-amber-300">
              {inventoryData?.summary?.item_count ?? 0}
            </Badge>
          </button>
        </div>

        {activeTab === 'inventory' && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-600" /> Inventory Date:
            </span>
            <Input
              type="date"
              value={inventoryDate}
              onChange={(e) => setInventoryDate(e.target.value)}
              className="h-9 w-40 bg-white border-slate-200 rounded-xl font-mono text-xs font-bold"
            />
          </div>
        )}
      </div>

      {/* TAB 1: PAWN TRANSACTIONS AUDIT */}
      {activeTab === 'pawns' && (
        <div className="space-y-6">
          {/* Search & Filters Card */}
          <div className="glass p-5 rounded-2xl border-slate-200 shadow-lg space-y-4">
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Branch Selector Dropdown */}
              <div className="flex items-center gap-2 bg-white/80 border border-slate-200 rounded-xl px-3 py-2 w-full md:w-auto shrink-0 shadow-xs">
                <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Branches (incl. Head Office)</option>
                  <option value="HQ">HQ - Head Office</option>
                  <option value="KHT">KHT - Kahathuduwa</option>
                  <option value="W4">W4 - Wattala 4</option>
                  <option value="BRL">BRL - Borella</option>
                  <option value="DHW">DHW - Dehiwala</option>
                  <option value="DMT">DMT - Dematagoda</option>
                  <option value="HMG">HMG - Homagama</option>
                  <option value="KDW">KDW - Kadawatha</option>
                  <option value="KIR">KIR - Kiribathgoda</option>
                  <option value="KOT">KOT - Kotikawatta</option>
                  <option value="KTW">KTW - Kottawa</option>
                  <option value="PND">PND - Panadura</option>
                  <option value="W2">W2 - Wattala 2</option>
                  <option value="W3">W3 - Wattala 3</option>
                </select>
              </div>

              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Bill No, Customer Name, NIC, or Phone..."
                  className="pl-10 h-11 bg-white/70 border-slate-200 rounded-xl font-semibold text-sm w-full focus:ring-amber-500 focus:border-amber-500"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Audit Status Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl shrink-0 w-full md:w-auto overflow-x-auto">
                {(['ALL', 'PENDING', 'PASSED', 'FLAGGED'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setAuditStatusFilter(filter)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      auditStatusFilter === filter
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {filter === 'ALL' ? 'All Audits' : filter === 'PENDING' ? 'Pending' : filter === 'PASSED' ? 'Passed' : 'Flagged'}
                  </button>
                ))}
              </div>

              {/* Pawn Status Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl shrink-0 w-full md:w-auto overflow-x-auto">
                {(['ALL', 'ACTIVE', 'AUDITED_PENDING_APPROVAL', 'PENDING_APPROVAL', 'REQUIRES_RECHECK', 'REDEEMED'] as const).map((pst) => (
                  <button
                    key={pst}
                    type="button"
                    onClick={() => setPawnStatusFilter(pst)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                      pawnStatusFilter === pst
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {pst === 'ALL' ? 'All Loans' : pst === 'ACTIVE' ? 'Active' : pst === 'AUDITED_PENDING_APPROVAL' ? '✓ Audited (Pending Mgr)' : pst === 'PENDING_APPROVAL' ? 'Pending Appr' : pst === 'REQUIRES_RECHECK' ? '⚠ Recheck Needed' : 'Redeemed'}
                  </button>
                ))}
              </div>

              {/* Packet Sticker Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl shrink-0 w-full md:w-auto overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setPacketFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                    packetFilter === 'ALL'
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Packets
                </button>
                <button
                  type="button"
                  onClick={() => setPacketFilter('ATTACHED')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                    packetFilter === 'ATTACHED'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5" />
                  Stickers Attached ({stats.stickeredCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPacketFilter('MISSING')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                    packetFilter === 'MISSING'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  No Sticker ({stats.missingStickerCount})
                </button>
              </div>
            </div>
          </div>

          {/* Transactions Audit Table */}
          <div className="glass rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-black text-slate-900">Branch Pawn Transactions</h2>
                <Badge variant="outline" className="font-mono text-xs font-bold ml-2">
                  {filteredPawns.length} tickets
                </Badge>
              </div>
              <span className="text-xs font-bold text-slate-400">
                Scope: <strong className="text-slate-800">{selectedBranch === 'ALL' ? 'All Branches (incl. Head Office)' : selectedBranch}</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="border-b border-slate-200/80">
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6">Bill No</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6">Customer</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6">Pawn Date &amp; Time</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6 text-right">Pawn Amount</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6">Item / Gold Details</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6 text-center">Proofs</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6 text-center">Loan Status</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6 text-center">Packet Sticker</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6 text-center">Audit Status</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-4 px-6 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-500 font-semibold">
                        <RefreshCcw className="w-6 h-6 animate-spin mx-auto text-amber-600 mb-2" />
                        Loading transactions for audit...
                      </TableCell>
                    </TableRow>
                  ) : filteredPawns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-500 font-semibold">
                        <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        No transactions match your search or filter criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPawns.map((pawn) => {
                      const auditRec = auditMap[pawn.bill_no];
                      const hasPhotos = Boolean(pawn.air_weight_photo_url || pawn.water_weight_photo_url);

                      return (
                        <TableRow key={pawn.id} className="hover:bg-amber-50/40 transition-colors border-b border-slate-100">
                          {/* Bill No */}
                          <TableCell className="px-6 py-4 font-mono font-black text-sm text-slate-900">
                            <div className="flex flex-col">
                              <Link 
                                href={`/dashboard/auditor/verify/${pawn.id || pawn.bill_no}`}
                                className="text-amber-700 hover:text-amber-800 hover:underline flex items-center gap-1.5 group font-mono font-black text-sm"
                                title="Open Full Verification Page"
                              >
                                <span>{pawn.bill_no || pawn.id.substring(0, 8).toUpperCase()}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-amber-500 group-hover:translate-x-0.5 transition-transform" />
                              </Link>
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[9px] font-black text-slate-600 w-fit">
                                {pawn.branch_id || 'HQ'}
                              </span>
                            </div>
                          </TableCell>

                          {/* Customer */}
                          <TableCell className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-black text-slate-900 text-sm">
                                {pawn.clients?.first_name || pawn.customer_name || 'Valued Customer'}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">
                                NIC: {pawn.clients?.national_id || '—'} {pawn.clients?.phone ? `• ${pawn.clients.phone}` : ''}
                              </span>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                                  pawn.clients?.nic_image ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}>
                                  NIC {pawn.clients?.nic_image ? '✓' : '✗'}
                                </span>
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                                  pawn.clients?.signature_image ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}>
                                  Sig {pawn.clients?.signature_image ? '✓' : '✗'}
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Created / Pawn Date */}
                          <TableCell className="px-6 py-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="font-black text-slate-800">
                                {pawn.created_at ? new Date(pawn.created_at).toLocaleDateString('en-GB') : '—'}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {pawn.created_at ? new Date(pawn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          </TableCell>

                          {/* Amount */}
                          <TableCell className="px-6 py-4 text-right">
                            <div className="flex flex-col items-end">
                              <span className="font-mono font-black text-sm text-slate-900">
                                Rs. {Number(pawn.disbursed_amount || 0).toLocaleString()}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                Appraised: Rs. {Number(pawn.appraised_value || 0).toLocaleString()}
                              </span>
                            </div>
                          </TableCell>

                          {/* Item Details */}
                          <TableCell className="px-6 py-4">
                            <div className="flex flex-col max-w-[200px]">
                              <span className="font-bold text-xs text-slate-800 truncate" title={pawn.description}>
                                {pawn.description || 'Pawn Collateral'}
                              </span>
                              <span className="text-[10px] text-amber-700 font-bold">
                                Weight: {((pawn.weight_mg || 0) / 1000 || pawn.weight_grams || pawn.weight || 0).toFixed(2)}g ({pawn.weight_mg || 0} mg)
                              </span>
                            </div>
                          </TableCell>

                          {/* Proofs */}
                          <TableCell className="px-6 py-4 text-center">
                            {hasPhotos ? (
                              <div className="flex items-center justify-center gap-1">
                                {pawn.air_weight_photo_url && (
                                  <img 
                                    src={pawn.air_weight_photo_url} 
                                    alt="Air" 
                                    className="w-6 h-6 object-cover rounded border border-amber-400"
                                    title="Air weight photo proof" 
                                  />
                                )}
                                {pawn.water_weight_photo_url && (
                                  <img 
                                    src={pawn.water_weight_photo_url} 
                                    alt="Water" 
                                    className="w-6 h-6 object-cover rounded border border-blue-400"
                                    title="Water weight photo proof" 
                                  />
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-bold">None</span>
                            )}
                          </TableCell>

                          {/* Loan Status */}
                          <TableCell className="px-6 py-4 text-center">
                            <Badge
                              variant="outline"
                              className={`font-black text-[9px] uppercase tracking-wider px-2.5 py-0.5 ${
                                pawn.status === 'REQUIRES_RECHECK'
                                  ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse font-black'
                                  : pawn.status === 'AUDITED_PENDING_APPROVAL'
                                  ? 'bg-blue-50 text-blue-800 border-blue-300 font-black'
                                  : pawn.status === 'ACTIVE'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                  : pawn.status === 'PENDING_APPROVAL'
                                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                              }`}
                            >
                              {pawn.status === 'REQUIRES_RECHECK' 
                                ? '⚠ REQUIRES RECHECK' 
                                : pawn.status === 'AUDITED_PENDING_APPROVAL'
                                ? '✓ AUDITED • PENDING MGR'
                                : pawn.status}
                            </Badge>
                          </TableCell>

                          {/* Packet Sticker */}
                          <TableCell className="px-6 py-4 text-center">
                            {pawn.packet_qr ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setScannerTargetPawn(pawn);
                                  setIsScannerOpen(true);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-mono text-[10px] font-black shadow-2xs transition-all cursor-pointer"
                                title={`Packet Sticker QR: ${pawn.packet_qr} (Click to re-scan / change)`}
                              >
                                <Tag className="w-3 h-3 text-emerald-600" />
                                <span className="max-w-[85px] truncate">{pawn.packet_qr}</span>
                              </button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setScannerTargetPawn(pawn);
                                  setIsScannerOpen(true);
                                }}
                                className="h-7 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 font-black text-[10px] rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
                                title="Scan and link sticker QR code"
                              >
                                <QrCode className="w-3 h-3 text-amber-600" />
                                Scan Sticker
                              </Button>
                            )}
                          </TableCell>

                          {/* Audit Status */}
                          <TableCell className="px-6 py-4 text-center">
                            {!auditRec ? (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-black text-[9px] uppercase tracking-widest gap-1">
                                <Clock className="w-3 h-3 text-amber-600" /> Pending Audit
                              </Badge>
                            ) : (
                              <div className="flex flex-col items-center">
                                <Badge className={`font-black text-[9px] uppercase tracking-widest gap-1 ${
                                  auditRec.status === 'PASSED'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : 'bg-rose-100 text-rose-800 border-rose-300'
                                }`}>
                                  {auditRec.status === 'PASSED' ? (
                                    <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified</>
                                  ) : (
                                    <><AlertTriangle className="w-3 h-3 text-rose-600" /> Flagged</>
                                  )}
                                </Badge>
                                <span className="text-[10px] font-black text-slate-800 mt-1 truncate max-w-[130px]" title={`Audited by ${auditRec.auditor_email}${auditRec.notes ? `: ${auditRec.notes}` : ''}`}>
                                  By: {auditRec.auditor_email.split('@')[0]}
                                </span>
                                <span className="text-[9px] font-mono text-slate-400">
                                  {auditRec.audited_at ? new Date(auditRec.audited_at).toLocaleDateString('en-GB') : ''}
                                </span>
                              </div>
                            )}
                          </TableCell>

                          {/* Action */}
                          <TableCell className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link href={`/dashboard/auditor/verify/${pawn.id || pawn.bill_no}`}>
                                <Button
                                  size="sm"
                                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs px-3 py-1.5 rounded-xl gap-1.5 cursor-pointer shadow-xs"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5 text-slate-950" /> Verify Pawn
                                </Button>
                              </Link>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenAuditModal(pawn)}
                                className="text-slate-600 hover:text-slate-900 font-bold text-xs p-1.5 h-8 w-8 rounded-lg cursor-pointer"
                                title="Quick Audit Modal"
                              >
                                <Eye className="w-4 h-4 text-slate-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: VAULT INVENTORY & REDIS CACHE AUDIT */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {/* Redis Cache Status & Audit Controls Banner */}
          <div className="glass p-5 rounded-3xl border border-amber-500/20 shadow-lg bg-gradient-to-r from-amber-500/5 via-slate-50/50 to-white flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-600" />
                <h3 className="text-base font-black text-slate-900">Vault Inventory Redis L1 Cache Layer</h3>
                {inventoryCacheStatus === 'HIT' ? (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-black text-[10px] uppercase tracking-wider flex items-center gap-1">
                    <Zap className="w-3 h-3 text-emerald-600" /> Cache Hit (Redis In-Memory)
                  </Badge>
                ) : inventoryCacheStatus === 'MISS' ? (
                  <Badge className="bg-blue-100 text-blue-800 border-blue-300 font-black text-[10px] uppercase tracking-wider">
                    Cache Miss (Fetched DB &amp; Cached)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-[10px]">Ready</Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 font-semibold font-mono">
                Key: <span className="text-slate-800 font-bold">inventory:branch:{selectedBranch}:date:{inventoryDate}</span> • TTL: <span className="text-amber-700 font-bold">300s (5m)</span>
              </p>
            </div>

            {/* Inventory List Section Dedicated Reload & Force Expire Controls */}
            <div className="flex items-center gap-2">
              <label 
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer border px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all select-none shadow-xs h-10",
                  forceExpireCache 
                    ? "bg-amber-500 border-amber-600 text-slate-950 shadow-amber-500/20 ring-2 ring-amber-500/30" 
                    : "bg-amber-50/80 hover:bg-amber-100 border-amber-200/80 text-amber-800"
                )}
                title="Auditor check button to force-expire Redis cache on reload"
              >
                <input
                  type="checkbox"
                  checked={forceExpireCache}
                  onChange={(e) => setForceExpireCache(e.target.checked)}
                  className="w-3.5 h-3.5 accent-amber-600 rounded cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Force Expire Cache
                </span>
              </label>

              <Button
                variant="outline"
                onClick={handleReload}
                disabled={loadingInventory || isInvalidatingCache}
                className={cn(
                  "h-10 px-4 border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-black text-xs uppercase tracking-wider rounded-xl gap-1.5 shadow-xs cursor-pointer transition-all",
                  forceExpireCache && "border-amber-500 bg-amber-50 text-amber-950 font-black"
                )}
                title={forceExpireCache ? "Reload and force-expire Redis cache" : "Reload inventory using cache by default"}
              >
                {loadingInventory || isInvalidatingCache ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5 text-slate-700" />
                )}
                Reload
              </Button>

              <Link href="/operations/eod?tab=stock">
                <Button
                  variant="ghost"
                  className="h-10 px-3 text-slate-600 hover:text-slate-900 font-bold text-xs rounded-xl gap-1 cursor-pointer"
                  title="Open full EOD & Stock Management module"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Full Stock Portal
                </Button>
              </Link>
            </div>
          </div>

          {/* Inventory Breakdown KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="glass border-blue-500/20 rounded-2xl p-4 shadow-sm bg-blue-500/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-700">Full Settlements (F/S)</span>
              <p className="text-xl font-black text-blue-900 mt-2 font-mono">
                Rs. {Number(inventoryData?.summary?.total_fs || 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-blue-600 font-semibold">{inventoryData?.data?.fs_items?.length || 0} settlements</p>
            </div>

            <div className="glass border-amber-500/20 rounded-2xl p-4 shadow-sm bg-amber-500/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Stock Interest</span>
              <p className="text-xl font-black text-amber-900 mt-2 font-mono">
                Rs. {Number(inventoryData?.summary?.total_interest || 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-amber-600 font-semibold">{inventoryData?.data?.interest_items?.length || 0} entries</p>
            </div>

            <div className="glass border-emerald-500/20 rounded-2xl p-4 shadow-sm bg-emerald-500/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Daily Receipts</span>
              <p className="text-xl font-black text-emerald-900 mt-2 font-mono">
                Rs. {Number(inventoryData?.summary?.total_receipts || 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-emerald-600 font-semibold">{inventoryData?.data?.receipt_items?.length || 0} receipts</p>
            </div>

            <div className="glass border-purple-500/20 rounded-2xl p-4 shadow-sm bg-purple-500/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-purple-700">Loans Disbursed</span>
              <p className="text-xl font-black text-purple-900 mt-2 font-mono">
                Rs. {Number(inventoryData?.summary?.total_loans || 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-purple-600 font-semibold">{inventoryData?.data?.loan_items?.length || 0} loans</p>
            </div>

            <div className="glass border-rose-500/20 rounded-2xl p-4 shadow-sm bg-rose-500/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">Redemptions</span>
              <p className="text-xl font-black text-rose-900 mt-2 font-mono">
                Rs. {Number(inventoryData?.summary?.total_redeems || 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-rose-600 font-semibold">{inventoryData?.data?.redeem_items?.length || 0} redeemed</p>
            </div>
          </div>

          {/* Inventory Items Table */}
          <div className="glass rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-black text-slate-900">Vault Inventory &amp; Daily Matrix Records</h3>
                <Badge variant="outline" className="font-mono text-xs font-bold ml-2">
                  {inventoryItems.length} records
                </Badge>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  placeholder="Filter by bill, notes, branch..."
                  className="pl-9 h-9 bg-white border-slate-200 rounded-xl font-semibold text-xs w-full"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="border-b border-slate-200/80">
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-3.5 px-6">Category</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-3.5 px-6">Bill / Ref</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-3.5 px-6">Date</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-3.5 px-6">Branch</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-3.5 px-6 text-right">Amount (Rs.)</TableHead>
                    <TableHead className="font-black text-xs uppercase tracking-wider text-slate-700 py-3.5 px-6">Notes / Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInventory ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-slate-500 font-semibold">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-amber-600 mb-2" />
                        Loading inventory records...
                      </TableCell>
                    </TableRow>
                  ) : inventoryItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-slate-500 font-semibold">
                        <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        No inventory records found for branch &quot;{selectedBranch}&quot; on {inventoryDate}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    inventoryItems.map((item: any, idx: number) => (
                      <TableRow key={item.id || idx} className="hover:bg-amber-50/30 transition-colors border-b border-slate-100">
                        <TableCell className="px-6 py-3.5">
                          <Badge variant="outline" className={cn("font-black text-[9px] uppercase tracking-wider px-2 py-0.5", item.badgeColor)}>
                            {item.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-6 py-3.5 font-mono font-black text-xs text-slate-900">
                          {item.bill_no || '—'}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-xs text-slate-600 font-medium">
                          {item.date || inventoryDate}
                        </TableCell>
                        <TableCell className="px-6 py-3.5">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] font-black text-slate-700">
                            {item.branch || selectedBranch}
                          </span>
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-right font-mono font-black text-xs text-slate-900">
                          Rs. {Number(item.amount || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-xs text-slate-600 max-w-[280px] truncate" title={item.notes}>
                          {item.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* Comprehensive Audit Inspection Modal */}
      <Dialog open={isAuditModalOpen} onOpenChange={setIsAuditModalOpen}>
        <DialogContent className="w-[95vw] sm:w-[90vw] lg:max-w-4xl bg-white border border-slate-200 shadow-2xl p-0 rounded-3xl flex flex-col overflow-hidden max-h-[90vh]">
          {/* Header */}
          <div className="h-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-500 shrink-0" />
          <div className="p-6 border-b border-slate-100">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 rounded-2xl text-amber-600">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl sm:text-2xl font-black text-slate-900">
                      Audit Inspection & Verification
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold text-slate-500 mt-0.5">
                      Bill Ticket: <span className="font-mono text-amber-600 font-black">{selectedPawn?.bill_no}</span> • Branch: <strong className="text-slate-800">{selectedPawn?.branch_id}</strong>
                    </DialogDescription>
                  </div>
                </div>
              </div>
            </DialogHeader>
          </div>

          {/* Modal Body */}
          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
            {selectedPawn && (
              <>
                {/* Audit History Banner if ticket was previously audited */}
                {auditMap[selectedPawn.bill_no] && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-amber-500 text-slate-950 rounded-xl shrink-0 mt-0.5">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900">
                            Audit History:
                          </span>
                          <Badge className={`text-[9px] font-black uppercase ${
                            auditMap[selectedPawn.bill_no].status === 'PASSED'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-rose-600 text-white'
                          }`}>
                            {auditMap[selectedPawn.bill_no].status === 'PASSED' ? '✓ Verified Passed' : '⚠ Flagged with Discrepancy'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-600 font-semibold">
                          Audited by <strong className="text-slate-900">{auditMap[selectedPawn.bill_no].auditor_email}</strong> on{' '}
                          <strong className="text-slate-900">{new Date(auditMap[selectedPawn.bill_no].audited_at).toLocaleString('en-GB')}</strong>
                        </p>
                        {auditMap[selectedPawn.bill_no].notes && (
                          <p className="text-xs text-slate-700 italic bg-white/70 p-2 rounded-lg border border-amber-200">
                            "{auditMap[selectedPawn.bill_no].notes}"
                          </p>
                        )}
                      </div>
                    </div>
                    <Link href={`/dashboard/auditor/verify/${selectedPawn.id || selectedPawn.bill_no}`}>
                      <Button size="sm" variant="outline" className="text-xs font-black rounded-xl border-amber-300 bg-white hover:bg-amber-50 text-amber-900 shrink-0 cursor-pointer">
                        Full Audit Trail & Dossier →
                      </Button>
                    </Link>
                  </div>
                )}

                {/* Section 1: Customer & Loan Overview */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Customer Card */}
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-amber-600" /> Customer Information
                    </span>
                    <p className="text-base font-black text-slate-900">
                      {selectedPawn.clients?.first_name || selectedPawn.customer_name || 'Valued Customer'}
                    </p>
                    <div className="text-xs text-slate-600 font-semibold space-y-1">
                      <p>NIC: <strong className="font-mono text-slate-900">{selectedPawn.clients?.national_id || 'Not specified'}</strong></p>
                      <p>Phone: <strong className="text-slate-900">{selectedPawn.clients?.phone || selectedPawn.phone || 'Not specified'}</strong></p>
                      <p>Address: <strong className="text-slate-900">{selectedPawn.clients?.address || 'Not specified'}</strong></p>
                    </div>
                  </div>

                  {/* Financials Card */}
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5 text-amber-600" /> Loan Terms & Amounts
                    </span>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-bold text-slate-600">Disbursed Amount:</span>
                      <span className="text-lg font-black font-mono text-slate-900">
                        Rs. {Number(selectedPawn.disbursed_amount || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs font-semibold text-slate-600">
                      <span>Appraised Valuation:</span>
                      <span className="font-mono font-bold text-slate-800">
                        Rs. {Number(selectedPawn.appraised_value || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs font-semibold text-slate-600">
                      <span>Interest Rate & Period:</span>
                      <span className="font-bold text-slate-800">
                        {selectedPawn.interest_rate}% • {selectedPawn.period_months || 3} Months
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs font-semibold text-slate-600">
                      <span>Originated Date:</span>
                      <span className="font-bold text-slate-800">
                        {selectedPawn.created_at ? new Date(selectedPawn.created_at).toLocaleString('en-GB') : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Collateral & Gold Breakdown */}
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Scale className="w-3.5 h-3.5 text-amber-600" /> Collateral & Scale Metrics
                    </span>
                    <Badge variant="outline" className="font-black text-[10px] bg-amber-100 text-amber-900 border-amber-300">
                      Total Weight: {((selectedPawn.weight_mg || 0) / 1000 || selectedPawn.weight_grams || selectedPawn.weight || 0).toFixed(2)} g
                    </Badge>
                  </div>

                  <p className="text-sm font-black text-slate-800">{selectedPawn.description || 'Pawn Collateral Items'}</p>

                  {/* Individual Items list if available */}
                  {selectedPawn.items && selectedPawn.items.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100/70 border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3 text-left font-bold text-slate-700">Item</th>
                            <th className="py-2 px-3 text-left font-bold text-slate-700">Purity</th>
                            <th className="py-2 px-3 text-right font-bold text-slate-700">Weight (mg)</th>
                            <th className="py-2 px-3 text-right font-bold text-slate-700">Valuation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPawn.items.map((item, idx) => (
                            <tr key={item.id || idx} className="border-b border-slate-100 last:border-b-0">
                              <td className="py-2 px-3 font-semibold text-slate-800">{item.item_type || item.description}</td>
                              <td className="py-2 px-3 font-bold text-amber-700">{item.purity || '22K'}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{item.weight_mg || 0}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                                Rs. {Number(item.appraised_value || 0).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Section 3: Photographic Scale Proofs */}
                <div className="space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5 text-amber-600" /> Scale Photographic Proofs
                  </span>

                  {(!selectedPawn.air_weight_photo_url && !selectedPawn.water_weight_photo_url) ? (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400 font-semibold text-xs">
                      <Camera className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      No scale photo proofs recorded for this bill ticket.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Air Weight Photo Card */}
                      <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 flex flex-col items-center">
                        <div className="w-full flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span> Air Weight Scale Photo
                          </span>
                          {selectedPawn.evaluation_air_weight ? (
                            <span className="text-xs font-mono font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                              {selectedPawn.evaluation_air_weight} mg
                            </span>
                          ) : null}
                        </div>
                        <div className="w-full aspect-video bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                          {selectedPawn.air_weight_photo_url ? (
                            <img 
                              src={selectedPawn.air_weight_photo_url} 
                              alt="Air Weight Scale Proof" 
                              className="w-full h-full object-contain cursor-zoom-in hover:opacity-95 transition-opacity"
                              onClick={() => {
                                const w = window.open("");
                                w?.document.write(`<img src="${selectedPawn.air_weight_photo_url}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                              }}
                            />
                          ) : (
                            <span className="text-xs text-slate-400 font-bold">No photo attached</span>
                          )}
                        </div>
                      </div>

                      {/* Water Weight Photo Card */}
                      <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 flex flex-col items-center">
                        <div className="w-full flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span> Water Weight Scale Photo
                          </span>
                          {selectedPawn.evaluation_water_weight ? (
                            <span className="text-xs font-mono font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                              {selectedPawn.evaluation_water_weight} mg
                            </span>
                          ) : null}
                        </div>
                        <div className="w-full aspect-video bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                          {selectedPawn.water_weight_photo_url ? (
                            <img 
                              src={selectedPawn.water_weight_photo_url} 
                              alt="Water Weight Scale Proof" 
                              className="w-full h-full object-contain cursor-zoom-in hover:opacity-95 transition-opacity"
                              onClick={() => {
                                const w = window.open("");
                                w?.document.write(`<img src="${selectedPawn.water_weight_photo_url}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                              }}
                            />
                          ) : (
                            <span className="text-xs text-slate-400 font-bold">No photo attached</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 3.5: Customer Identity & Signature Evidence */}
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5 text-amber-600" /> Customer Identity & Signature Evidence
                    </span>
                    <Link href={`/dashboard/auditor/verify/${selectedPawn.id || selectedPawn.bill_no}`}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] font-black text-amber-800 bg-amber-100/80 border-amber-300 hover:bg-amber-200 rounded-lg gap-1 cursor-pointer"
                      >
                        <Camera className="w-3 h-3" /> Capture / Verify in Dossier →
                      </Button>
                    </Link>
                  </div>

                  {(() => {
                    let quickNicFront: string | null = null;
                    let quickNicBack: string | null = null;
                    const cImg = selectedPawn.clients?.nic_image;
                    if (cImg) {
                      try {
                        const parsed = JSON.parse(cImg);
                        quickNicFront = parsed.front || null;
                        quickNicBack = parsed.back || null;
                      } catch {
                        if (typeof cImg === 'string' && (cImg.startsWith('data:') || cImg.startsWith('http'))) {
                          quickNicFront = cImg;
                        }
                      }
                    }
                    const quickSig = selectedPawn.clients?.signature_image || null;

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Front NIC */}
                        <div className="bg-white rounded-xl p-3 border border-slate-200 flex flex-col items-center">
                          <div className="w-full flex items-center justify-between mb-2">
                            <span className="text-[11px] font-bold text-slate-700">NIC (Front)</span>
                            <Badge variant="outline" className={`text-[9px] font-black ${quickNicFront ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>
                              {quickNicFront ? 'Captured ✓' : 'Missing ✗'}
                            </Badge>
                          </div>
                          <div className="w-full h-24 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200">
                            {quickNicFront ? (
                              <img
                                src={quickNicFront}
                                alt="NIC Front"
                                className="w-full h-full object-contain cursor-pointer hover:opacity-90"
                                onClick={() => {
                                  const w = window.open('');
                                  w?.document.write(`<img src="${quickNicFront}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                                }}
                              />
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">No Front Photo</span>
                            )}
                          </div>
                        </div>

                        {/* Back NIC */}
                        <div className="bg-white rounded-xl p-3 border border-slate-200 flex flex-col items-center">
                          <div className="w-full flex items-center justify-between mb-2">
                            <span className="text-[11px] font-bold text-slate-700">NIC (Back)</span>
                            <Badge variant="outline" className={`text-[9px] font-black ${quickNicBack ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>
                              {quickNicBack ? 'Captured ✓' : 'Missing ✗'}
                            </Badge>
                          </div>
                          <div className="w-full h-24 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200">
                            {quickNicBack ? (
                              <img
                                src={quickNicBack}
                                alt="NIC Back"
                                className="w-full h-full object-contain cursor-pointer hover:opacity-90"
                                onClick={() => {
                                  const w = window.open('');
                                  w?.document.write(`<img src="${quickNicBack}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                                }}
                              />
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">No Back Photo</span>
                            )}
                          </div>
                        </div>

                        {/* Signature */}
                        <div className="bg-white rounded-xl p-3 border border-slate-200 flex flex-col items-center">
                          <div className="w-full flex items-center justify-between mb-2">
                            <span className="text-[11px] font-bold text-slate-700">Customer Signature</span>
                            <Badge variant="outline" className={`text-[9px] font-black ${quickSig ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>
                              {quickSig ? 'Captured ✓' : 'Missing ✗'}
                            </Badge>
                          </div>
                          <div className="w-full h-24 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200">
                            {quickSig ? (
                              <img
                                src={quickSig}
                                alt="Customer Signature"
                                className="w-full h-full object-contain cursor-pointer hover:opacity-90 bg-white"
                                onClick={() => {
                                  const w = window.open('');
                                  w?.document.write(`<img src="${quickSig}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                                }}
                              />
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">No Signature Recorded</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Section 4: Auditor Decision & Observation Notes */}
                <div className="bg-amber-500/5 rounded-2xl p-5 border border-amber-500/20 space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Auditor Evaluation & Decision
                  </span>

                  {/* Decision Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setAuditDecision('PASSED')}
                      className={`p-3 rounded-xl border flex items-center gap-2 font-black text-xs transition-all cursor-pointer ${
                        auditDecision === 'PASSED'
                          ? 'bg-emerald-500 text-white border-emerald-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Passed / Verified
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuditDecision('FLAGGED')}
                      className={`p-3 rounded-xl border flex items-center gap-2 font-black text-xs transition-all cursor-pointer ${
                        auditDecision === 'FLAGGED'
                          ? 'bg-rose-500 text-white border-rose-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4" /> Flag Discrepancy
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuditDecision('IN_REVIEW')}
                      className={`p-3 rounded-xl border flex items-center gap-2 font-black text-xs transition-all cursor-pointer ${
                        auditDecision === 'IN_REVIEW'
                          ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Clock className="w-4 h-4" /> Under Review
                    </button>
                  </div>

                  {/* Observation Notes */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700">
                      Audit Notes & Findings
                    </label>
                    <textarea
                      rows={3}
                      value={auditNotes}
                      onChange={(e) => setAuditNotes(e.target.value)}
                      placeholder="Enter audit observations (e.g. verified air/water weight matching scale photos, karat purity check passed)..."
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAuditModalOpen(false)}
              className="font-bold text-xs h-10 px-5 rounded-xl border-slate-200 cursor-pointer"
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={handleSaveAudit}
              disabled={isSavingAudit}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs h-10 px-6 rounded-xl shadow-md cursor-pointer gap-2"
            >
              {isSavingAudit ? (
                <RefreshCcw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              Save Audit Record
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vault Packet Sticker QR Scanner Modal */}
      <PacketQrScannerModal
        isOpen={isScannerOpen}
        onClose={() => {
          setIsScannerOpen(false);
          setScannerTargetPawn(null);
        }}
        targetBillNo={scannerTargetPawn?.bill_no}
        targetPawnId={scannerTargetPawn?.id}
        currentPacketQr={scannerTargetPawn?.packet_qr}
        customerName={scannerTargetPawn?.clients?.first_name || scannerTargetPawn?.customer_name}
        weightFormatted={scannerTargetPawn?.weight ? `${scannerTargetPawn.weight.toFixed(3)} g` : undefined}
        availablePawns={pawns}
        onSuccess={(scannedQr, billNo) => {
          // Immediately update pawns state in place
          setPawns((prev) => prev.map((p) => {
            if (p.bill_no === billNo || (scannerTargetPawn && p.id === scannerTargetPawn.id)) {
              return { ...p, packet_qr: scannedQr };
            }
            return p;
          }));
        }}
      />
    </div>
  );
}
