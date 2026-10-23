'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, 
  CreditCard, 
  User, 
  Phone, 
  Calendar, 
  Coins, 
  Receipt, 
  Printer, 
  Bluetooth, 
  ArrowRight, 
  Check, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCcw, 
  FileText, 
  ShieldCheck, 
  DollarSign, 
  Sparkles,
  MapPin,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { WebBluetoothTransport } from '@/lib/bluetooth/WebBluetoothTransport';
import { EscPosAdapter } from '@/lib/bluetooth/EscPosAdapter';

interface ClientItem {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  national_id?: string;
  nationalId?: string;
  nic?: string;
  phone?: string;
  mobile?: string;
  address?: string;
  address_line1?: string;
  branch_id?: string;
  branchId?: string;
}

interface PawnItem {
  id: string;
  bill_no: string;
  client_id?: string;
  client?: ClientItem;
  amount: number | string;
  created_at?: string;
  pawning_date?: string;
  status?: string;
  description?: string;
  weight?: string | number;
  appraised_value?: number | string;
  interest_rate?: number;
  branch_id?: string;
  branch?: string;
}

interface InterestRecord {
  id: string;
  bill_no: string;
  date: string;
  interest_value: number;
  branch: string;
  notes?: string;
  created_at?: string;
}

export default function InterestPaymentPage() {
  // Search & Client State
  const [searchQuery, setSearchQuery] = useState('');
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientItem | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Pawn Bills State
  const [pawnBills, setPawnBills] = useState<PawnItem[]>([]);
  const [selectedBill, setSelectedBill] = useState<PawnItem | null>(null);
  const [isLoadingBills, setIsLoadingBills] = useState(false);

  // Interest History State for selected bill
  const [billInterestHistory, setBillInterestHistory] = useState<InterestRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Payment Form State
  const todayStr = new Date().toISOString().split('T')[0];
  const [paymentDate, setPaymentDate] = useState<string>(todayStr);
  const [interestAmount, setInterestAmount] = useState<string>('');
  const [monthlyRatePercent, setMonthlyRatePercent] = useState<number>(2.5);
  const [paidMonthsOption, setPaidMonthsOption] = useState<number>(1);
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'BANK' | 'CHEQUE'>('CASH');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bluetooth Printing State & Receipt Modal
  const [isBtPrinting, setIsBtPrinting] = useState(false);
  const [activeReceiptData, setActiveReceiptData] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Active User / Branch Info
  const [activeBranch, setActiveBranch] = useState<string>('HEAD OFFICE');
  const [cashierName, setCashierName] = useState<string>('Staff');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load User Info from LocalStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user');
      const storedBranch = localStorage.getItem('user_branch');
      if (storedUser) {
        try {
          const u = JSON.parse(storedUser);
          setCashierName(u.name || u.firstName || u.first_name || 'Staff');
          if (u.branchId) setActiveBranch(u.branchId);
        } catch {}
      }
      if (storedBranch) {
        setActiveBranch(storedBranch);
      }
    }
  }, []);

  // Fetch Clients Directory
  useEffect(() => {
    const fetchClients = async () => {
      try {
        setIsSearching(true);
        const res = await fetch('/api/clients', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setClients(data);
          }
        }
      } catch (err) {
        console.warn('Failed to load clients list:', err);
      } finally {
        setIsSearching(false);
      }
    };
    fetchClients();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter Matching Clients
  const matchingClients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return clients.filter(c => {
      const nic = String(c.national_id || c.nationalId || c.nic || '').toLowerCase();
      const name = `${c.first_name || ''} ${c.last_name || ''} ${c.name || ''}`.toLowerCase();
      const phone = String(c.phone || c.mobile || '').toLowerCase();
      return nic.includes(q) || name.includes(q) || phone.includes(q);
    }).slice(0, 10);
  }, [searchQuery, clients]);

  // Load Pawn Bills when Client is Selected
  const loadPawnBillsForClient = async (client: ClientItem) => {
    setIsLoadingBills(true);
    setSelectedBill(null);
    setBillInterestHistory([]);
    try {
      const nic = (client.national_id || client.nationalId || client.nic || '').trim();
      const clientId = client.id;

      // 1. Fetch pawns from /api/pawns
      const res = await fetch('/api/pawns?filterBranch=ALL', { cache: 'no-store' });
      let clientBills: PawnItem[] = [];

      if (res.ok) {
        const allPawns = await res.json();
        if (Array.isArray(allPawns)) {
          clientBills = allPawns.filter((p: any) => {
            const matchClient = p.client_id === clientId || 
              (p.client && (p.client.national_id === nic || p.client.id === clientId));
            return matchClient && p.status !== 'REDEEMED' && p.status !== 'CANCELLED';
          });
        }
      }

      // 2. Fallback search by bill number if matching in stock items
      if (clientBills.length === 0) {
        const stockRes = await fetch('/api/pawns?search=' + encodeURIComponent(nic), { cache: 'no-store' });
        if (stockRes.ok) {
          const searchData = await stockRes.json();
          if (Array.isArray(searchData)) {
            clientBills = searchData;
          }
        }
      }

      setPawnBills(clientBills);

      // Auto-select if there is exactly 1 active bill
      if (clientBills.length === 1) {
        selectPawnBill(clientBills[0]);
      }
    } catch (err) {
      console.error('Failed to load client bills:', err);
      toast.error('Failed to retrieve customer pawn bills.');
    } finally {
      setIsLoadingBills(false);
    }
  };

  // Select a Bill & Calculate Interest
  const selectPawnBill = async (bill: PawnItem) => {
    setSelectedBill(bill);
    loadInterestHistory(bill.bill_no);

    // Calculate standard 1 month interest
    const principal = parseFloat(String(bill.amount || '0')) || 0;
    const rate = bill.interest_rate || monthlyRatePercent || 2.5;
    const oneMonth = Math.round((principal * (rate / 100)));

    setInterestAmount(String(oneMonth));
    setPaidMonthsOption(1);
    setPaymentNotes(`Interest for 1 month (Rate: ${rate}%)`);
  };

  // Load Interest History for selected bill
  const loadInterestHistory = async (billNo: string) => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`/api/stock/interest?bill_no=${encodeURIComponent(billNo)}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const records = json.data || [];
        setBillInterestHistory(records);
      }
    } catch (err) {
      console.warn('Failed to load bill interest history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Total Interest Paid to date for selected bill
  const totalInterestPaidToDate = useMemo(() => {
    return billInterestHistory.reduce((sum, r) => sum + (parseFloat(String(r.interest_value)) || 0), 0);
  }, [billInterestHistory]);

  // Last Interest Payment Record
  const lastInterestRecord = useMemo(() => {
    if (billInterestHistory.length === 0) return null;
    return [...billInterestHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [billInterestHistory]);

  // Handle Quick Month Selection
  const handleSelectMonths = (months: number) => {
    setPaidMonthsOption(months);
    if (!selectedBill) return;
    const principal = parseFloat(String(selectedBill.amount || '0')) || 0;
    const rate = selectedBill.interest_rate || monthlyRatePercent || 2.5;
    const calculated = Math.round(principal * (rate / 100) * months);
    setInterestAmount(String(calculated));
    setPaymentNotes(`Interest for ${months} month${months > 1 ? 's' : ''} (Rate: ${rate}%)`);
  };

  // Select Client from Dropdown
  const handleSelectClient = (client: ClientItem) => {
    setSelectedClient(client);
    setSearchQuery(client.national_id || client.nationalId || client.nic || '');
    setIsDropdownOpen(false);
    loadPawnBillsForClient(client);
  };

  // Clear Selected Client
  const handleClearSelection = () => {
    setSelectedClient(null);
    setSelectedBill(null);
    setPawnBills([]);
    setBillInterestHistory([]);
    setSearchQuery('');
  };

  // Submit Interest Payment
  const handleRecordInterest = async (printBluetooth = false) => {
    if (!selectedBill) {
      toast.error('Please select a bill number first.');
      return;
    }

    const numericAmount = parseFloat(interestAmount);
    if (!numericAmount || numericAmount <= 0) {
      toast.error('Please enter a valid interest payment amount.');
      return;
    }

    if (!paymentDate) {
      toast.error('Please select the payment date.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Recording interest payment...');

    try {
      const branchToUse = selectedBill.branch_id || selectedBill.branch || activeBranch || 'HEAD OFFICE';

      const payload = {
        bill_no: selectedBill.bill_no.trim(),
        item_id: selectedBill.id,
        date: paymentDate,
        interest_value: numericAmount,
        branch: branchToUse,
        notes: `${paymentNotes || 'Pawn Interest Payment'} [Mode: ${paymentMode}] [Cashier: ${cashierName}]`
      };

      const res = await fetch('/api/stock/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to save interest payment.');
      }

      toast.success(`Interest Rs. ${numericAmount.toLocaleString()} recorded for Bill ${selectedBill.bill_no} ✓`, { id: toastId });

      // Build receipt data
      const receiptData = {
        receiptNo: `REC-INT-${Date.now().toString().slice(-6)}`,
        billNo: selectedBill.bill_no,
        date: paymentDate,
        customerName: `${selectedClient?.first_name || ''} ${selectedClient?.last_name || ''}`.trim() || selectedClient?.name || 'Customer',
        customerNic: selectedClient?.national_id || selectedClient?.nationalId || selectedClient?.nic || 'N/A',
        customerPhone: selectedClient?.phone || selectedClient?.mobile || 'N/A',
        customerAddress: selectedClient?.address || selectedClient?.address_line1 || 'Sri Lanka',
        principal: parseFloat(String(selectedBill.amount || '0')),
        articleDescription: selectedBill.description || 'Pawned Gold Articles',
        weight: selectedBill.weight ? `${selectedBill.weight}` : 'N/A',
        interestPaid: numericAmount,
        paidPeriod: paymentNotes,
        paymentMode: paymentMode,
        branch: branchToUse,
        cashier: cashierName,
        totalPaidToDate: totalInterestPaidToDate + numericAmount
      };

      setActiveReceiptData(receiptData);
      setShowReceiptModal(true);

      // Refresh interest history
      loadInterestHistory(selectedBill.bill_no);

      // Trigger Bluetooth Print if requested
      if (printBluetooth) {
        printViaBluetooth(receiptData);
      }

    } catch (err: any) {
      console.error('Interest submission error:', err);
      toast.error(err.message || 'Error occurred while recording interest.', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Direct Bluetooth Print Function
  const printViaBluetooth = async (data: any) => {
    setIsBtPrinting(true);
    const toastId = toast.loading('Connecting to Bluetooth Thermal Printer...');

    try {
      const transport = new WebBluetoothTransport();
      const connected = await transport.connect();
      if (!connected) throw new Error('Could not connect to Bluetooth printer.');

      toast.loading('Printing interest bill...', { id: toastId });

      const adapter = new EscPosAdapter();
      const sep = '----------------------------------------';
      const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const cleanSinhala = (str: string) => (str || '').replace(/[\u0D80-\u0DFF]+/g, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();

      const lines: Uint8Array[] = [
        adapter.init(),
        // ── HEADER (centered) ──
        adapter.align(1),
        adapter.text('RUPASINGHE TRUST\n', true, true, true),
        adapter.text('INVESTMENTS LTD.\n', true, false, true),
        adapter.text('(PREV. L.S. RUPASINGHE PAWN BROKERS)\n'),
        adapter.text(`${data.branch || 'Dehiwala Head Office'}\n`),
        adapter.text('Tel: 011 7006588\n'),
        adapter.text(`${sep}\n`),
        adapter.text('** PAWN INTEREST RECEIPT **\n', true, false, true),
        adapter.text(`${sep}\n`),

        // ── META (left) ──
        adapter.align(0),
        adapter.text(`Receipt No : ${data.receiptNo}\n`, true),
        adapter.text(`Bill No    : ${data.billNo}\n`, true),
        adapter.text(`Payment Dt : ${data.date}\n`),
        adapter.text(`${sep}\n`),

        // ── CUSTOMER INFO ──
        adapter.text(`Customer   : ${cleanSinhala(data.customerName)}\n`),
        adapter.text(`NIC        : ${data.customerNic}\n`),
        adapter.text(`Phone      : ${data.customerPhone}\n`),
        adapter.text(`Address    : ${cleanSinhala(data.customerAddress)}\n`),
        adapter.text(`${sep}\n`),

        // ── ARTICLE & LOAN INFO ──
        adapter.text(`Article    : ${cleanSinhala(data.articleDescription)}\n`),
        adapter.text(`Weight     : ${data.weight}\n`),
        adapter.text(`Principal  : Rs. ${fmt(data.principal)}\n`),
        adapter.text(`${sep}\n`),

        // ── INTEREST PAYMENT AMOUNT (centered & bold) ──
        adapter.align(1),
        adapter.text(`INTEREST PAID: Rs. ${fmt(data.interestPaid)}\n`, true, false, true),
        adapter.text(`${sep}\n`),

        // ── DETAILS (left) ──
        adapter.align(0),
        adapter.text(`Notes / Period : ${cleanSinhala(data.paidPeriod)}\n`),
        adapter.text(`Payment Mode   : ${data.paymentMode}\n`),
        adapter.text(`Total Paid Till: Rs. ${fmt(data.totalPaidToDate)}\n`),
        adapter.text(`Cashier / User : ${data.cashier}\n`),
        adapter.text(`${sep}\n`),

        // ── SIGNATURES ──
        adapter.feed(2),
        adapter.text('Customer Signature      Cashier Signature\n'),
        adapter.text('-------------------     -------------------\n'),
        adapter.align(1),
        adapter.text('Thank you for transacting with Rupasinghe Trust!\n'),
        adapter.feed(4),
        adapter.cut(),
      ];

      const payload = EscPosAdapter.concat(lines);
      await transport.write(payload);

      toast.success('Interest Bill Printed via Bluetooth!', { id: toastId });
      setTimeout(() => transport.disconnect(), 1200);

    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.message?.includes('cancel')) {
        toast.error('Bluetooth connection was cancelled.', { id: toastId });
      } else {
        toast.error('Bluetooth Print Failed: ' + (err.message || 'Check printer connection'), { id: toastId });
      }
    } finally {
      setIsBtPrinting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ── TOP PAGE HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs font-bold uppercase tracking-wider">
                Finance & Pawning
              </Badge>
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-xs font-mono">
                {activeBranch}
              </Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Coins className="w-6 h-6 text-amber-400" />
              <span>Pawn Interest Payment & Billing</span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              Search customer NIC, select active pawn ticket, set payment date, and print thermal receipt via Bluetooth printer.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClearSelection}
              className="border-slate-800 bg-slate-900 text-slate-300 hover:text-white text-xs font-bold h-9 rounded-xl"
            >
              <RefreshCcw className="w-3.5 h-3.5 mr-1" /> New Search
            </Button>
          </div>
        </div>

        {/* ── STEP 1: CUSTOMER NIC SEARCH BOX ── */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl relative" ref={dropdownRef}>
          <Label className="text-xs font-black uppercase tracking-wider text-amber-400 block mb-2 flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400" />
            <span>Step 1: Search Customer by NIC Number or Name</span>
          </Label>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              placeholder="Type Customer NIC (e.g. 941234567V or 199412345678) or Name..."
              className="pl-11 pr-10 h-13 bg-slate-950 border-slate-700 text-white font-mono font-bold text-sm rounded-2xl focus:border-amber-500 focus:ring-amber-500/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Auto-suggest dropdown */}
          {isDropdownOpen && searchQuery.trim().length > 0 && (
            <div className="absolute z-50 left-5 right-5 mt-2 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-72 overflow-y-auto divide-y divide-slate-800">
              {matchingClients.length > 0 ? (
                matchingClients.map((client) => {
                  const nic = client.national_id || client.nationalId || client.nic || '';
                  const name = `${client.first_name || ''} ${client.last_name || ''} ${client.name || ''}`.trim();
                  const phone = client.phone || client.mobile || 'No Phone';
                  const branch = client.branch_id || client.branchId || '';

                  return (
                    <div
                      key={client.id || nic}
                      onClick={() => handleSelectClient(client)}
                      className="p-3.5 hover:bg-slate-800/80 cursor-pointer transition-colors flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center font-bold text-xs shrink-0">
                          <User className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white text-sm">{nic}</span>
                            {branch && (
                              <Badge className="bg-slate-800 text-slate-400 border-slate-700 text-[9px] uppercase">
                                {branch}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-semibold text-slate-300">{name || 'Unnamed Client'}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono text-slate-400">{phone}</div>
                        <span className="text-[10px] font-bold text-amber-400 flex items-center justify-end gap-1 mt-0.5">
                          Select Customer <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-center text-xs text-slate-400 font-medium">
                  No matching customer found with NIC: <span className="font-mono text-amber-400">{searchQuery}</span>
                </div>
              )}
            </div>
          )}

          {/* Customer Details Banner once selected */}
          {selectedClient && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-950 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold">
                  <Check className="w-5 h-5 stroke-[3]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-white text-sm">
                      {`${selectedClient.first_name || ''} ${selectedClient.last_name || ''}`.trim() || selectedClient.name || 'Verified Customer'}
                    </span>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-mono text-xs">
                      {selectedClient.national_id || selectedClient.nationalId || selectedClient.nic}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-500" />
                      <span className="font-mono">{selectedClient.phone || selectedClient.mobile || 'No Phone'}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-500" />
                      <span>{selectedClient.address || selectedClient.address_line1 || 'No Address'}</span>
                    </span>
                  </div>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
                className="text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-900"
              >
                Change Customer
              </Button>
            </div>
          )}
        </div>

        {/* ── STEP 2: ACTIVE PAWN BILLS LIST ── */}
        {selectedClient && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-400" />
                <span>Step 2: Select Customer Bill Number</span>
              </Label>
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-xs">
                {pawnBills.length} Bill{pawnBills.length !== 1 ? 's' : ''} on File
              </Badge>
            </div>

            {isLoadingBills ? (
              <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCcw className="w-4 h-4 animate-spin text-amber-400" />
                <span>Loading active pawn bills...</span>
              </div>
            ) : pawnBills.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pawnBills.map((bill) => {
                  const isSelected = selectedBill?.id === bill.id;
                  const principal = parseFloat(String(bill.amount || '0')) || 0;
                  const dateStr = bill.created_at ? bill.created_at.split('T')[0] : (bill.pawning_date || 'N/A');

                  return (
                    <div
                      key={bill.id || bill.bill_no}
                      onClick={() => selectPawnBill(bill)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10 scale-[1.01]'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono font-black text-white text-base">
                          {bill.bill_no}
                        </span>
                        <Badge className={`${isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'} font-bold text-[10px]`}>
                          {isSelected ? 'SELECTED ✓' : 'SELECT'}
                        </Badge>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-400">
                          <span>Principal Loan:</span>
                          <span className="font-mono font-bold text-amber-400">Rs. {principal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Pawn Date:</span>
                          <span className="font-mono text-slate-300">{dateStr}</span>
                        </div>
                        {bill.description && (
                          <div className="flex justify-between text-slate-400">
                            <span>Articles:</span>
                            <span className="font-semibold text-slate-300 truncate max-w-[150px]">{bill.description}</span>
                          </div>
                        )}
                        {bill.weight && (
                          <div className="flex justify-between text-slate-400">
                            <span>Weight:</span>
                            <span className="font-mono text-slate-300">{bill.weight}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-2xl">
                No active pawn tickets found for this customer.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: PAY INTEREST & PRINT BILL ── */}
        {selectedBill && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

            {/* Left 2 Cols: Payment Inputs & Calculation */}
            <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-5">
              <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                <div>
                  <Label className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-400" />
                    <span>Step 3: Pay Interest for Bill: {selectedBill.bill_no}</span>
                  </Label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Select payment date, pick or enter interest amount, and print receipt.
                  </p>
                </div>

                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 font-mono font-bold">
                  Principal: Rs. {(parseFloat(String(selectedBill.amount || '0')) || 0).toLocaleString()}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Payment Date Selection */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5 uppercase">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" />
                    <span>Payment Date</span>
                  </Label>
                  <Input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="h-11 bg-slate-950 border-slate-700 text-white font-mono font-bold rounded-xl"
                  />
                </div>

                {/* Monthly Rate % */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5 uppercase">
                    <Coins className="w-3.5 h-3.5 text-amber-400" />
                    <span>Monthly Interest Rate (%)</span>
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={monthlyRatePercent}
                    onChange={(e) => {
                      const rate = parseFloat(e.target.value) || 0;
                      setMonthlyRatePercent(rate);
                      const principal = parseFloat(String(selectedBill.amount || '0')) || 0;
                      setInterestAmount(String(Math.round(principal * (rate / 100) * paidMonthsOption)));
                    }}
                    className="h-11 bg-slate-950 border-slate-700 text-white font-mono font-bold rounded-xl"
                  />
                </div>
              </div>

              {/* Quick Month Selector Chips */}
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Select Interest Duration
                </Label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {[1, 2, 3, 6].map((m) => {
                    const principal = parseFloat(String(selectedBill.amount || '0')) || 0;
                    const calculated = Math.round(principal * (monthlyRatePercent / 100) * m);
                    const isSelected = paidMonthsOption === m;

                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleSelectMonths(m)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-bold'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="text-[10px] font-black uppercase tracking-wider">
                          {m} Month{m > 1 ? 's' : ''}
                        </div>
                        <div className="font-mono text-xs font-black mt-0.5">
                          Rs. {calculated.toLocaleString()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Interest Amount (Customizable) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center justify-between">
                  <span>Interest Amount to Pay (Rs.)</span>
                  <span className="text-[10px] text-slate-400 normal-case font-medium">Editable if custom/partial</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-amber-400 font-mono">
                    Rs.
                  </span>
                  <Input
                    type="number"
                    value={interestAmount}
                    onChange={(e) => {
                      setInterestAmount(e.target.value);
                      setPaidMonthsOption(0); // custom
                    }}
                    placeholder="Enter amount..."
                    className="pl-12 h-14 bg-slate-950 border-amber-500/40 text-amber-300 font-mono font-black text-xl rounded-2xl focus:border-amber-500 focus:ring-amber-500/20"
                  />
                </div>
              </div>

              {/* Payment Mode & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-slate-300 uppercase">
                    Payment Mode
                  </Label>
                  <select
                    value={paymentMode}
                    onChange={(e: any) => setPaymentMode(e.target.value)}
                    className="w-full h-11 px-3 bg-slate-950 border border-slate-700 text-white font-bold text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="CASH">Cash Payment</option>
                    <option value="BANK">Bank Transfer / Online</option>
                    <option value="CHEQUE">Cheque Payment</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-slate-300 uppercase">
                    Period Description / Notes
                  </Label>
                  <Input
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="e.g. Interest for 1 month..."
                    className="h-11 bg-slate-950 border-slate-700 text-white text-xs rounded-xl"
                  />
                </div>
              </div>

              {/* Action Buttons: Bluetooth Print & Pay */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Button
                  type="button"
                  disabled={isSubmitting || isBtPrinting || !interestAmount}
                  onClick={() => handleRecordInterest(true)}
                  className="flex-1 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black text-sm uppercase tracking-wider h-13 rounded-2xl shadow-xl shadow-amber-500/20 gap-2 cursor-pointer border border-amber-300 active:scale-[0.99] transition-all"
                >
                  <Bluetooth className="w-5 h-5" />
                  <span>{isBtPrinting ? 'Printing to BT...' : 'Pay & Print BT Bill'}</span>
                </Button>

                <Button
                  type="button"
                  disabled={isSubmitting || !interestAmount}
                  onClick={() => handleRecordInterest(false)}
                  variant="outline"
                  className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900 font-bold text-xs h-13 px-6 rounded-2xl gap-2 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Record Only (No BT)</span>
                </Button>
              </div>
            </div>

            {/* Right Col: Bill Summary & Past Interest History */}
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                    Bill Ledger Summary
                  </span>
                  <Badge className="bg-slate-800 text-amber-400 font-mono text-xs">
                    {selectedBill.bill_no}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Interest Paid:</span>
                    <span className="font-mono font-bold text-emerald-400">Rs. {totalInterestPaidToDate.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Payment Count:</span>
                    <span className="font-mono text-white">{billInterestHistory.length} time{billInterestHistory.length !== 1 ? 's' : ''}</span>
                  </div>
                  {lastInterestRecord && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Payment Date:</span>
                      <span className="font-mono text-amber-300">{lastInterestRecord.date}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Past Interest Records Table */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" /> Past Interest Entries
                  </span>
                  <Badge className="bg-slate-800 text-slate-400 text-[10px]">
                    {billInterestHistory.length}
                  </Badge>
                </div>

                {isLoadingHistory ? (
                  <div className="py-4 text-center text-xs text-slate-500">Loading history...</div>
                ) : billInterestHistory.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {billInterestHistory.map((rec) => (
                      <div
                        key={rec.id}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center justify-between"
                      >
                        <div>
                          <div className="font-mono font-bold text-emerald-400">
                            Rs. {parseFloat(String(rec.interest_value)).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{rec.date}</div>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const recData = {
                              receiptNo: rec.id,
                              billNo: selectedBill.bill_no,
                              date: rec.date,
                              customerName: `${selectedClient?.first_name || ''} ${selectedClient?.last_name || ''}`.trim() || selectedClient?.name || 'Customer',
                              customerNic: selectedClient?.national_id || selectedClient?.nationalId || selectedClient?.nic || 'N/A',
                              customerPhone: selectedClient?.phone || selectedClient?.mobile || 'N/A',
                              customerAddress: selectedClient?.address || selectedClient?.address_line1 || 'Sri Lanka',
                              principal: parseFloat(String(selectedBill.amount || '0')),
                              articleDescription: selectedBill.description || 'Pawned Gold Articles',
                              weight: selectedBill.weight ? `${selectedBill.weight}` : 'N/A',
                              interestPaid: rec.interest_value,
                              paidPeriod: rec.notes || 'Interest Payment',
                              paymentMode: 'PAID',
                              branch: rec.branch || activeBranch,
                              cashier: cashierName,
                              totalPaidToDate: totalInterestPaidToDate
                            };
                            setActiveReceiptData(recData);
                            setShowReceiptModal(true);
                          }}
                          className="h-7 px-2 text-[10px] font-bold text-amber-400 hover:text-amber-300 hover:bg-slate-900"
                        >
                          <Printer className="w-3 h-3 mr-1" /> Reprint
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-slate-500">
                    No prior interest recorded for this bill.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── THERMAL RECEIPT PREVIEW & PRINT MODAL ── */}
        {showReceiptModal && activeReceiptData && (
          <div 
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setShowReceiptModal(false)}
          >
            <div 
              className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4" /> Thermal Receipt Preview
                </span>
                <button
                  type="button"
                  onClick={() => setShowReceiptModal(false)}
                  className="text-slate-400 hover:text-white text-xs font-bold p-1"
                >
                  ✕
                </button>
              </div>

              {/* Receipt Render View (Simulating 80mm ESC/POS Paper) */}
              <div className="bg-white text-black font-mono text-xs p-4 rounded-xl shadow-inner space-y-2 border border-slate-300 max-h-[60vh] overflow-y-auto">
                <div className="text-center font-bold">
                  <div className="text-sm font-black">RUPASINGHE TRUST</div>
                  <div className="text-xs">INVESTMENTS LTD.</div>
                  <div className="text-[10px] text-gray-600">(PREV. L.S. RUPASINGHE PAWN BROKERS)</div>
                  <div className="text-[10px]">{activeReceiptData.branch} • Tel: 011 7006588</div>
                  <div className="my-1 border-t border-dashed border-gray-400" />
                  <div className="text-xs font-black uppercase">** PAWN INTEREST RECEIPT **</div>
                  <div className="my-1 border-t border-dashed border-gray-400" />
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>Receipt No:</span>
                    <span className="font-bold">{activeReceiptData.receiptNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Bill No:</span>
                    <span className="font-bold">{activeReceiptData.billNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{activeReceiptData.date}</span>
                  </div>
                  <div className="border-t border-gray-300 my-1" />
                  <div>Customer: <strong>{activeReceiptData.customerName}</strong></div>
                  <div>NIC: <strong>{activeReceiptData.customerNic}</strong></div>
                  <div>Phone: {activeReceiptData.customerPhone}</div>
                  <div className="border-t border-gray-300 my-1" />
                  <div>Article: {activeReceiptData.articleDescription}</div>
                  <div>Weight: {activeReceiptData.weight}</div>
                  <div>Principal: Rs. {Number(activeReceiptData.principal).toLocaleString()}</div>
                  <div className="border-t border-dashed border-gray-400 my-1" />
                </div>

                {/* Big Interest Paid Amount */}
                <div className="border-2 border-black p-2 text-center my-2">
                  <div className="text-[10px] uppercase font-bold">INTEREST PAID</div>
                  <div className="text-base font-black">
                    Rs. {Number(activeReceiptData.interestPaid).toLocaleString()}
                  </div>
                </div>

                <div className="space-y-1 text-[10px]">
                  <div>Period: {activeReceiptData.paidPeriod}</div>
                  <div>Mode: {activeReceiptData.paymentMode}</div>
                  <div>Cashier: {activeReceiptData.cashier}</div>
                  <div className="border-t border-gray-300 my-2" />
                  <div className="pt-4 flex justify-between text-center text-[9px]">
                    <div className="border-t border-black w-24">Customer</div>
                    <div className="border-t border-black w-24">Cashier</div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={isBtPrinting}
                  onClick={() => printViaBluetooth(activeReceiptData)}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider h-11 rounded-xl shadow-lg gap-1.5"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span>{isBtPrinting ? 'Printing...' : 'Print Bluetooth (BT)'}</span>
                </Button>

                <Button
                  type="button"
                  onClick={() => window.print()}
                  variant="outline"
                  className="border-slate-700 bg-slate-950 text-white hover:bg-slate-800 text-xs font-bold h-11 rounded-xl gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>Browser Print</span>
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
