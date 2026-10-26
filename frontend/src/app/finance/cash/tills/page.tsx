'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Building2, PlusCircle, RefreshCcw, CheckCircle2, Lock, Unlock, 
  ArrowLeft, Coins, Banknote, ShieldAlert, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getAuthHeaders, getCurrentUser } from '@/lib/getAuthHeaders';
import { CANONICAL_BRANCHES } from '@/lib/branch-mapping';
import { DenominationCounter, DenominationState } from '@/components/DenominationCounter';

const initialDenoms: DenominationState = {
  notes_5000: '',
  notes_2000: '',
  notes_1000: '',
  notes_500: '',
  notes_100: '',
  notes_50: '',
  notes_20: '',
  notes_10: '',
  coins_total: ''
};

export default function CashTillsPage() {
  const [tills, setTills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedBranch, setSelectedBranch] = useState('BRL');

  // New Till Modal
  const [isNewTillOpen, setIsNewTillOpen] = useState(false);
  const [newTillName, setNewTillName] = useState('Counter 01 Till');
  const [newTillRole, setNewTillRole] = useState('TELLER');

  // Open Session Modal
  const [isOpenSessionOpen, setIsOpenSessionOpen] = useState(false);
  const [activeTill, setActiveTill] = useState<any | null>(null);
  const [openingCash, setOpeningCash] = useState('');

  // Close Session Modal (Denominations)
  const [isCloseSessionOpen, setIsCloseSessionOpen] = useState(false);
  const [closeDenoms, setCloseDenoms] = useState<DenominationState>(initialDenoms);
  const [closeNotes, setCloseNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadTills = async () => {
    setLoading(true);
    try {
      const u = getCurrentUser();
      setCurrentUser(u);
      if (u?.branchId && u.role === 'TELLER') {
        setSelectedBranch(u.branchId);
      }

      const headers = getAuthHeaders();
      const res = await fetch(`/api/cash/tills?branchId=${selectedBranch}`, { headers });
      if (res.ok) {
        setTills(await res.json());
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load cash tills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTills();
  }, [selectedBranch]);

  const handleCreateTill = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/tills', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          branchId: selectedBranch,
          tillName: newTillName,
          assignedRole: newTillRole
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create till');

      toast.success(`Till ${newTillName} created successfully!`);
      setIsNewTillOpen(false);
      loadTills();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTill) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/tills/session', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'OPEN',
          tillId: activeTill.id,
          openingCash: parseFloat(openingCash || '0')
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to open till shift');

      toast.success(`Till shift opened with Rs. ${Number(openingCash || 0).toLocaleString()}!`);
      setIsOpenSessionOpen(false);
      setOpeningCash('');
      loadTills();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTill?.activeSession) return;
    setSubmitting(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cash/tills/session', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'CLOSE',
          sessionId: activeTill.activeSession.id,
          denominations: closeDenoms,
          notes: closeNotes
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to close till shift');

      if (json.status === 'FLAGGED') {
        toast.warning(`Till closed with variance of Rs. ${json.variance}. Flagged for review!`);
      } else {
        toast.success('Till closed cleanly with zero variance!');
      }

      setIsCloseSessionOpen(false);
      setCloseDenoms(initialDenoms);
      setCloseNotes('');
      loadTills();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isManagerOrAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/finance/cash">
            <Button variant="ghost" size="icon" className="rounded-xl">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              Cash Tills & <span className="text-emerald-600">Daily Shifts</span>
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-0.5">
              Cashier drawer opening, closing, physical denomination count, and variance auditing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {currentUser?.role !== 'TELLER' && (
            <Select value={selectedBranch} onValueChange={(val) => setSelectedBranch(val || 'BRL')}>
              <SelectTrigger className="h-10 font-bold text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANONICAL_BRANCHES.filter(b => b.id !== 'TEST').map(b => (
                  <SelectItem key={b.id} value={b.id} className="font-bold text-xs">
                    {b.name} ({b.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button variant="outline" size="sm" onClick={loadTills} disabled={loading} className="rounded-xl h-10 font-bold">
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {isManagerOrAdmin && (
            <Button size="sm" onClick={() => setIsNewTillOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl h-10 shadow-sm shadow-emerald-600/20">
              <PlusCircle className="w-4 h-4 mr-1.5" /> Add New Till Drawer
            </Button>
          )}
        </div>
      </div>

      {/* Tills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tills.length === 0 ? (
          <div className="col-span-full text-center py-12 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <Banknote className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No cash drawers registered for branch {selectedBranch}. Click "Add New Till Drawer" to initialize one.
          </div>
        ) : (
          tills.map((till: any) => {
            const hasOpenSession = Boolean(till.activeSession);

            return (
              <Card key={till.id} className="rounded-2xl border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-base font-bold">{till.tillName}</CardTitle>
                      <span className="font-mono text-xs text-slate-400">Branch: {till.branchId}</span>
                    </div>
                    <Badge variant="outline" className={hasOpenSession ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-slate-300 text-slate-500'}>
                      {hasOpenSession ? 'Shift Active' : 'Shift Closed'}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-3">
                  {hasOpenSession ? (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Opening Balance:</span>
                        <span className="font-mono font-bold">Rs. {till.activeSession.openingCash.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Expected in Till:</span>
                        <span className="font-mono font-bold text-emerald-600">Rs. {till.activeSession.systemExpectedCash.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Opened At:</span>
                        <span className="font-mono">{new Date(till.activeSession.openedAt).toLocaleTimeString()}</span>
                      </div>

                      <div className="pt-3">
                        <Button
                          className="w-full bg-slate-900 hover:bg-black text-white font-bold h-9 text-xs rounded-xl"
                          onClick={() => {
                            setActiveTill(till);
                            setIsCloseSessionOpen(true);
                          }}
                        >
                          <Lock className="w-3.5 h-3.5 mr-1.5" /> End Shift & Physical Count
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs text-slate-500 py-2">
                      <p>Drawer is currently locked and closed. Open a shift to start recording loan payouts and redemptions.</p>
                      <Button
                        variant="outline"
                        className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold h-9 text-xs rounded-xl"
                        onClick={() => {
                          setActiveTill(till);
                          setIsOpenSessionOpen(true);
                        }}
                      >
                        <Unlock className="w-3.5 h-3.5 mr-1.5" /> Open Till Shift
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Modal 1: Create Till */}
      <Dialog open={isNewTillOpen} onOpenChange={setIsNewTillOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Register Cash Drawer</DialogTitle>
            <DialogDescription className="text-xs">
              Add a new physical cash till to branch {selectedBranch}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateTill} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-bold">Till / Counter Name</Label>
              <Input
                required
                placeholder="e.g. Counter 02 Till"
                value={newTillName}
                onChange={(e) => setNewTillName(e.target.value)}
                className="mt-1 h-10 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Assigned Role</Label>
              <Select value={newTillRole} onValueChange={(val) => setNewTillRole(val || 'TELLER')}>
                <SelectTrigger className="mt-1 h-10 font-bold text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TELLER">Cashier / Teller</SelectItem>
                  <SelectItem value="MANAGER">Branch Vault Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsNewTillOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                {submitting ? 'Creating...' : 'Register Till'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Open Till Shift */}
      <Dialog open={isOpenSessionOpen} onOpenChange={setIsOpenSessionOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Open Till Shift</DialogTitle>
            <DialogDescription className="text-xs">
              Record opening cash float for {activeTill?.tillName} ({activeTill?.branchId})
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleOpenSession} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-bold">Opening Cash Float (LKR)</Label>
              <Input
                type="number"
                min="0"
                step="500"
                placeholder="e.g. 50000"
                required
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className="mt-1 h-10 font-mono font-bold text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpenSessionOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                {submitting ? 'Opening...' : 'Confirm Open Shift'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 3: Close Till Shift & Physical Count */}
      <Dialog open={isCloseSessionOpen} onOpenChange={setIsCloseSessionOpen}>
        <DialogContent className="sm:max-w-[620px] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">End Shift & Denomination Count</DialogTitle>
            <DialogDescription className="text-xs">
              Count all physical notes in {activeTill?.tillName}. Server will calculate variance against expected drawer balance.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCloseSession} className="space-y-4 pt-2">
            <DenominationCounter
              denominations={closeDenoms}
              onChange={setCloseDenoms}
              expectedAmount={activeTill?.activeSession?.systemExpectedCash}
            />

            <div>
              <Label className="text-xs font-bold">Shift Handover Notes (if any)</Label>
              <Input
                placeholder="e.g. Float handed over to evening cashier"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                className="mt-1 h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setIsCloseSessionOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-slate-900 hover:bg-black text-white font-bold">
                {submitting ? 'Closing...' : 'Close Till & Verify Count'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
