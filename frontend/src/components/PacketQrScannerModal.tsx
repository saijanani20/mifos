'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  QrCode, Camera, CheckCircle2, AlertTriangle, X, 
  RefreshCw, ShieldCheck, Search, Tag, Sparkles, ExternalLink,
  Trash2, Lock
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import Link from 'next/link';

interface PacketQrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetBillNo?: string;
  targetPawnId?: string;
  currentPacketQr?: string;
  customerName?: string;
  weightFormatted?: string;
  onSuccess?: (packetQr: string, billNo: string) => void;
}

export default function PacketQrScannerModal({
  isOpen,
  onClose,
  targetBillNo,
  targetPawnId,
  currentPacketQr,
  customerName,
  weightFormatted,
  onSuccess
}: PacketQrScannerModalProps) {
  const [activeTab, setActiveTab] = useState<'camera' | 'manual'>('camera');
  const [scannedCode, setScannedCode] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');
  const [manualBillNo, setManualBillNo] = useState<string>(targetBillNo || '');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [matchedPawn, setMatchedPawn] = useState<any>(null);
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string>('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        setUserRole(u.role || '');
      }
    } catch (e) {}
  }, []);

  const isAuditorOrAdmin = userRole === 'AUDITOR' || userRole === 'ADMIN';

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'packet-qr-reader';

  // Sound feedback on scan
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // High pleasant A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // AudioContext may be blocked before gesture
    }
  };

  // Start Camera Scanner
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch (e) {}
      }

      const html5QrCode = new Html5Qrcode(readerElementId);
      scannerRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      await html5QrCode.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          handleCodeDetected(decodedText);
        },
        () => {
          // Frame scan error ignored
        }
      );
      setIsCameraActive(true);
    } catch (err: any) {
      console.warn('Camera start error:', err);
      setCameraError(err?.message || 'Unable to access camera. Please allow camera permissions or use the barcode scanner input.');
      setIsCameraActive(false);
    }
  };

  // Stop Camera
  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        console.warn('Error stopping scanner:', e);
      }
      scannerRef.current = null;
    }
    setIsCameraActive(false);
  };

  // When modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setScannedCode('');
      setManualCode('');
      setMatchedPawn(null);
      setManualBillNo(targetBillNo || '');
      if (activeTab === 'camera') {
        const timer = setTimeout(() => {
          startCamera();
        }, 300);
        return () => clearTimeout(timer);
      }
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  // Handle scanned code
  const handleCodeDetected = async (code: string) => {
    if (!code || code.trim() === '') return;
    playBeep();
    setScannedCode(code);
    setManualCode(code);

    // Stop scanning while displaying result
    await stopCamera();

    // If target bill is already provided, immediately offer to save or auto-save
    if (targetBillNo || targetPawnId) {
      toast.success(`Packet Sticker Scanned: "${code.length > 25 ? code.substring(0, 25) + '...' : code}"`);
    } else {
      // Global audit lookup
      performLookup(code);
    }
  };

  // Lookup pawn by scanned code
  const performLookup = async (code: string) => {
    setIsLookingUp(true);
    try {
      const res = await fetch(`/api/pawns/packet-lookup?qr=${encodeURIComponent(code)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.found && json.pawn) {
          setMatchedPawn(json.pawn);
          setManualBillNo(json.pawn.bill_no);
          toast.success(`Found matching Bill #${json.pawn.bill_no}!`);
        }
      } else {
        setMatchedPawn(null);
        toast.info('No existing bill paired with this sticker yet. You can pair it now below.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLookingUp(false);
    }
  };

  // Save / Bind Packet QR to Bill
  const handleSavePacketQr = async () => {
    if (!isAuditorOrAdmin) {
      toast.error('Forbidden. Only Auditor accounts can assign packet stickers.');
      return;
    }

    const codeToSave = manualCode || scannedCode;
    const billToSave = manualBillNo || targetBillNo;

    if (!codeToSave || codeToSave.trim() === '') {
      toast.error('Please scan or enter a packet sticker QR code');
      return;
    }
    if (!billToSave || billToSave.trim() === '') {
      toast.error('Please enter or select a Bill Number to pair this sticker with');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading(`Binding packet sticker to Bill #${billToSave}...`);

    try {
      const targetId = targetPawnId || billToSave;
      const res = await fetch(`/api/pawns/${encodeURIComponent(targetId)}/packet-qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          packet_qr: codeToSave.trim(),
          bill_no: billToSave.trim()
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save packet sticker QR');
      }

      toast.success(`Packet sticker attached to Bill #${billToSave}!`, { id: toastId });
      if (onSuccess) {
        onSuccess(codeToSave.trim(), billToSave.trim());
      }
      onClose();
    } catch (err: any) {
      console.error('Save packet QR error:', err);
      toast.error(err.message || 'Error saving packet QR', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete / Unlink Packet QR from Bill
  const handleDeletePacketQr = async () => {
    const billToDelete = manualBillNo || targetBillNo;
    if (!billToDelete) return;

    if (!isAuditorOrAdmin) {
      toast.error('Forbidden. Only Auditor accounts can delete packet stickers.');
      return;
    }

    if (!confirm(`Are you sure you want to delete and unlink the packet sticker QR for Bill #${billToDelete}? Only Auditors can perform this.`)) {
      return;
    }

    setIsDeleting(true);
    const toastId = toast.loading(`Deleting packet sticker for Bill #${billToDelete}...`);

    try {
      const targetId = targetPawnId || billToDelete;
      const res = await fetch(`/api/pawns/${encodeURIComponent(targetId)}/packet-qr`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to delete packet sticker QR');
      }

      toast.success(`Packet sticker QR deleted for Bill #${billToDelete}`, { id: toastId });
      setScannedCode('');
      setManualCode('');
      if (onSuccess) {
        onSuccess('', billToDelete);
      }
      onClose();
    } catch (err: any) {
      console.error('Delete packet QR error:', err);
      toast.error(err.message || 'Error deleting packet QR', { id: toastId });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl bg-white/95 backdrop-blur-2xl border-white/60 shadow-2xl rounded-3xl p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/25">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  Vault Packet Sticker Scanner
                  <Sparkles className="w-4 h-4 text-amber-500" />
                </DialogTitle>
                <DialogDescription className="text-xs font-semibold text-slate-500">
                  Scan packet sticker QR code to pair or verify physical gold packet in vault
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Target Bill Info Banner (if attached to specific bill) */}
        {targetBillNo && (
          <div className="my-2 p-3.5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Target Pawn Ticket</span>
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-slate-900">Bill #{targetBillNo}</span>
                {customerName && (
                  <Badge variant="outline" className="bg-white/80 text-slate-700 border-amber-300 font-bold text-[11px]">
                    {customerName}
                  </Badge>
                )}
              </div>
            </div>
            {weightFormatted && (
              <div className="text-right">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Weight</span>
                <div className="text-sm font-black text-amber-900">{weightFormatted}</div>
              </div>
            )}
          </div>
        )}

        {/* Tab Toggle: Camera vs Barcode / Manual */}
        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-2xl my-2">
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'camera' 
                ? 'bg-white text-slate-900 shadow-sm' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" /> Live Camera Scan
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('manual');
              stopCamera();
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'manual' 
                ? 'bg-white text-slate-900 shadow-sm' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Tag className="w-4 h-4" /> Barcode Gun / Manual Input
          </button>
        </div>

        {/* Camera View */}
        {activeTab === 'camera' && (
          <div className="space-y-3">
            <div className="relative w-full aspect-square max-h-[260px] bg-slate-900 rounded-2xl overflow-hidden flex flex-col items-center justify-center border-2 border-dashed border-amber-400/40">
              <div id={readerElementId} className="w-full h-full" />
              
              {!isCameraActive && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white gap-2 z-10">
                  <Camera className="w-8 h-8 text-amber-400 animate-pulse" />
                  <p className="text-xs font-semibold text-slate-300">Initializing camera feed...</p>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 p-4 flex flex-col items-center justify-center bg-slate-950/90 text-center gap-2 z-10">
                  <AlertTriangle className="w-8 h-8 text-rose-400" />
                  <p className="text-xs text-rose-200 font-medium px-4">{cameraError}</p>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={startCamera}
                    className="mt-2 bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs font-bold"
                  >
                    Retry Camera
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
              <span>Hold the gold packet sticker inside the square</span>
              {isCameraActive && (
                <button
                  type="button"
                  onClick={startCamera}
                  className="text-amber-600 hover:text-amber-700 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh Feed
                </button>
              )}
            </div>
          </div>
        )}

        {/* Barcode Gun / Manual Entry */}
        {activeTab === 'manual' && (
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5">
                Scan with Barcode Gun or Enter Sticker Code
              </label>
              <div className="relative">
                <Input
                  autoFocus
                  value={manualCode}
                  onChange={(e) => {
                    setManualCode(e.target.value);
                    if (!targetBillNo && e.target.value.trim().length > 3) {
                      performLookup(e.target.value.trim());
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (manualCode.trim()) {
                        playBeep();
                        if (targetBillNo) {
                          handleSavePacketQr();
                        } else {
                          performLookup(manualCode.trim());
                        }
                      }
                    }
                  }}
                  placeholder="e.g. PKT-00129, RUP-GOLD-8492, or QR payload"
                  className="h-12 bg-white border-slate-200 text-slate-900 font-mono text-sm rounded-2xl pl-10 focus:ring-amber-500"
                />
                <QrCode className="w-5 h-5 text-slate-400 absolute left-3 top-3.5" />
              </div>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                Tip: USB / Bluetooth Barcode Scanners work automatically — simply point and trigger the scanner button.
              </p>
            </div>
          </div>
        )}

        {/* Scanned Result & Matched Pawn Display */}
        {(scannedCode || manualCode) && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Scanned Packet Sticker
              </span>
              <button
                type="button"
                onClick={() => {
                  setScannedCode('');
                  setManualCode('');
                  setMatchedPawn(null);
                  if (activeTab === 'camera') startCamera();
                }}
                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                Clear / Re-scan
              </button>
            </div>
            <div className="font-mono text-xs font-black text-slate-900 break-all bg-white/80 p-2.5 rounded-xl border border-amber-200">
              {manualCode || scannedCode}
            </div>

            {/* If not pre-targeted bill, allow specifying or confirms matched bill */}
            {!targetBillNo && (
              <div className="pt-2 border-t border-amber-200/50 space-y-2">
                {matchedPawn ? (
                  <div className="flex items-center justify-between bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                    <div>
                      <div className="text-[10px] font-black uppercase text-emerald-700">Paired Pawn Ticket</div>
                      <div className="text-sm font-black text-slate-900">Bill #{matchedPawn.bill_no}</div>
                      <div className="text-xs text-slate-600">
                        {matchedPawn.clients?.first_name || matchedPawn.customer_name} • {matchedPawn.weight?.toFixed(3) || '0.000'} g
                      </div>
                    </div>
                    <Link
                      href={`/dashboard/auditor/verify/${matchedPawn.id || matchedPawn.bill_no}`}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1"
                    >
                      Audit View <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-700 block mb-1">
                      Assign to Bill Number
                    </label>
                    <Input
                      value={manualBillNo}
                      onChange={(e) => setManualBillNo(e.target.value.toUpperCase())}
                      placeholder="e.g. BRL-0001, KOT-0042"
                      className="h-10 bg-white font-bold text-xs uppercase rounded-xl border-slate-200"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isAuditorOrAdmin && (
          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 flex items-center gap-2.5 text-xs font-bold text-amber-900">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Read-Only mode: Only Auditor accounts can attach or delete packet stickers.</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-slate-100">
          <div>
            {(targetBillNo || manualBillNo) && (currentPacketQr || scannedCode) && isAuditorOrAdmin && (
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting || isSubmitting}
                onClick={handleDeletePacketQr}
                className="h-11 px-4 rounded-2xl text-xs font-black uppercase tracking-wider text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200 flex items-center gap-1.5 cursor-pointer"
                title="Permanently remove packet sticker from this bill"
              >
                {isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete QR
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-11 px-5 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={(!manualCode && !scannedCode) || isSubmitting || !isAuditorOrAdmin}
              onClick={handleSavePacketQr}
              className="h-11 px-6 rounded-2xl text-xs font-black uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              Save & Pair Packet Sticker
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
