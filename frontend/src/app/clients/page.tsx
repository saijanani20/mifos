'use client';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { getBranchSearchTerms, normalizeBranchId, isNationalId, stripBranchPrefix } from '@/lib/branch-mapping';

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { 
  Plus, Search, UserPlus, Sparkles, Filter, MoreVertical, RefreshCcw, 
  Pencil, Trash2, ShieldCheck, UserCog, Camera, CameraOff, MapPin, Image,
  Users, Edit, FileText, Check, AlertTriangle, CheckCircle2, Eye, Upload, ZoomIn
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { printLoanAgreement } from "@/lib/loanAgreementPrint"

// Reusable Live Webcam Capture Component
const WebcamCapture = ({ 
  onCapture, 
  label, 
  initialImage,
  autoStart = false
}: { 
  onCapture: (base64: string | null) => void; 
  label: string; 
  initialImage?: string | null; 
  autoStart?: boolean; 
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(initialImage || null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCapturedImage(initialImage || null);
  }, [initialImage]);

  // Connect stream to video element whenever stream changes or videoRef attaches
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn("Video play notice:", e));
    }
  }, [stream]);

  // Enumerate active camera inputs
  const enumerateCameras = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
      setDevices(videoDevices);
      if (videoDevices.length > 0 && !activeDeviceId) {
        setActiveDeviceId(videoDevices[0].deviceId);
      }
    } catch (e) {
      console.error("Camera enumeration failed:", e);
    }
  };

  const startCamera = async (deviceIdToUse?: string) => {
    const targetId = deviceIdToUse || activeDeviceId;
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      let mediaStream: MediaStream;
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      };
      if (targetId && targetId.trim() !== "") {
        videoConstraints.deviceId = { exact: targetId };
      }

      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      } catch {
        // Fallback to simple video constraint if specific resolution or deviceId is rejected
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      
      setStream(mediaStream);
      setError(null);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(e => console.warn("Video play notice:", e));
      }

      // Re-enumerate devices now that permissions have been granted
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        setDevices(videoDevices);
        if (videoDevices.length > 0 && !activeDeviceId) {
          setActiveDeviceId(videoDevices[0].deviceId);
        }
      } catch {}
    } catch (err: any) {
      console.error("Camera access error:", err);
      setError("Webcam access denied or unavailable. You can also upload a photo file below.");
    }
  };

  useEffect(() => {
    enumerateCameras();
    if (autoStart && !capturedImage) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [autoStart]);

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas) {
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', 0.88);
        setCapturedImage(base64);
        onCapture(base64);
        stopCamera();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const base64 = evt.target.result as string;
          setCapturedImage(base64);
          onCapture(base64);
          stopCamera();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const switchCamera = () => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex(d => d.deviceId === activeDeviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    const nextDevice = devices[nextIndex];
    setActiveDeviceId(nextDevice.deviceId);
    if (stream) {
      startCamera(nextDevice.deviceId);
    }
  };

  const reset = () => {
    setCapturedImage(null);
    onCapture(null);
    startCamera();
  };

  const cancelWebcam = () => {
    stopCamera();
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const activeLabel = devices.find(d => d.deviceId === activeDeviceId)?.label || "Default Camera";

  return (
    <div className="space-y-2 bg-slate-900/50 border border-white/10 rounded-2xl p-4 transition-all">
      {/* Hidden file input for file upload fallback */}
      <input 
        ref={fileInputRef}
        type="file" 
        accept="image/*" 
        className="hidden" 
        onChange={handleFileUpload} 
      />

      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5 text-primary" /> {label}
        </span>
        <div className="flex items-center gap-1.5">
          {devices.length > 1 && stream && (
            <button
              type="button"
              onClick={switchCamera}
              className="bg-primary/20 text-primary border border-primary/20 hover:bg-primary/30 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1"
              title={`Switch camera input source (Active: ${activeLabel})`}
            >
              <RefreshCcw className="w-3 h-3 animate-spin duration-1000" /> Switch Cam
            </button>
          )}
          {capturedImage && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-black uppercase tracking-widest px-2 py-0.5">
              Captured ✓
            </Badge>
          )}
        </div>
      </div>
      
      {capturedImage ? (
        <div className="relative rounded-xl overflow-hidden border border-emerald-500/30 bg-slate-950 group">
          <img 
            src={capturedImage} 
            alt={label} 
            className="w-full h-44 object-contain bg-black/60 cursor-pointer" 
            onClick={() => setPreviewZoom(true)}
            title="Click to view full photo"
          />
          <div className="absolute top-2 left-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setPreviewZoom(true)}
              className="bg-slate-900/90 hover:bg-slate-900 text-white text-[9px] font-bold px-2 py-1 rounded-lg border border-white/20 flex items-center gap-1 shadow-sm cursor-pointer"
            >
              <ZoomIn className="w-3 h-3 text-amber-400" /> View Full
            </button>
          </div>
          <div className="absolute bottom-2 right-2 flex gap-2">
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              className="bg-slate-900/90 text-slate-200 text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-slate-950 transition-all cursor-pointer flex items-center gap-1"
            >
              <Upload className="w-3 h-3" /> File
            </button>
            <button 
              type="button" 
              onClick={reset}
              className="bg-primary text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-primary/20 hover:bg-primary/90 transition-all cursor-pointer shadow-md"
            >
              Retake Photo
            </button>
          </div>
        </div>
      ) : stream ? (
        <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-primary/20">
          <video 
            ref={videoRef}
            autoPlay 
            playsInline 
            muted
            className="w-full h-44 object-cover scale-x-[-1]" 
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2 px-4">
            <button 
              type="button" 
              onClick={capture}
              className="bg-primary hover:bg-primary/90 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" /> Capture Photo
            </button>
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-1"
            >
              <Upload className="w-3 h-3" /> Upload File
            </button>
            <button 
              type="button" 
              onClick={cancelWebcam}
              className="bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[9px] font-black uppercase tracking-widest px-2.5 py-2 rounded-lg transition-all cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="h-44 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl bg-white/5 gap-2 p-3 text-center">
          {error ? (
            <p className="text-[11px] font-bold text-rose-400 px-4">{error}</p>
          ) : (
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Web Camera is offline</p>
          )}
          <div className="flex gap-2 mt-1">
            <button 
              type="button" 
              onClick={() => startCamera()}
              className="bg-primary/20 text-primary border border-primary/20 hover:bg-primary/30 text-[9px] font-black uppercase tracking-widest px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" /> Start Webcam
            </button>
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              className="bg-white/10 text-white border border-white/20 hover:bg-white/20 text-[9px] font-black uppercase tracking-widest px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> Upload File
            </button>
          </div>
        </div>
      )}

      {/* Enlarged Photo Preview Modal */}
      {previewZoom && capturedImage && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewZoom(false)}
        >
          <div className="relative max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-2xl p-3 shadow-2xl flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <div className="w-full flex items-center justify-between pb-2 border-b border-slate-800 text-white text-xs font-bold">
              <span>{label} — Full Preview</span>
              <button 
                type="button"
                onClick={() => setPreviewZoom(false)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded-lg"
              >
                ✕ Close
              </button>
            </div>
            <img 
              src={capturedImage} 
              alt={label} 
              className="w-full max-h-[70vh] object-contain rounded-xl mt-2" 
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default function ClientsPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Stock Customers State
  const [stockCustomers, setStockCustomers] = useState<any[]>([]);
  const [showCustomerRegistryModal, setShowCustomerRegistryModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Form State - Add Customer
  const [custName, setCustName] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custAddress2, setCustAddress2] = useState("");
  const [custTp, setCustTp] = useState("");
  const [custNic, setCustNic] = useState("");
  const [custBills, setCustBills] = useState("");

  // Autocomplete Suggestions
  const [nameSuggestions, setNameSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [isUsingSupabase, setIsUsingSupabase] = useState(true);

  // Agreement Modal State
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [agreementClientNum, setAgreementClientNum] = useState("");
  const [agreementDate, setAgreementDate] = useState("");
  const [agreementBorrowerName, setAgreementBorrowerName] = useState("");
  const [agreementNic, setAgreementNic] = useState("");
  const [agreementAddress, setAgreementAddress] = useState("");
  const [agreementLoanLimit, setAgreementLoanLimit] = useState("100000");
  const [agreementServiceFee, setAgreementServiceFee] = useState("3.5");
  const [agreementInterest, setAgreementInterest] = useState("0");
  const [agreementCode, setAgreementCode] = useState("");

  // Form State
  const [nic, setNic] = useState('');
  const [firstName, setFirstName] = useState(''); // Mapped to Name with Initials
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');         // Mapped to TP
  const [address, setAddress] = useState('');
  const [nicFrontImage, setNicFrontImage] = useState<string | null>(null);
  const [nicBackImage, setNicBackImage] = useState<string | null>(null);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [activeKycTab, setActiveKycTab] = useState<'nic_front' | 'nic_back' | 'signature'>('nic_front');

  const [branchId, setBranchId] = useState('');
  const [userId, setUserId] = useState('');
  const [userRole, setUserRole] = useState('');
  const [editingClient, setEditingClient] = useState<any>(null);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('ALL');
  const [branches, setBranches] = useState<any[]>([]);

  // Customer KYC Photo Viewer Dialog State
  const [photoViewerClient, setPhotoViewerClient] = useState<{
    isOpen: boolean;
    name: string;
    nic: string;
    front?: string | null;
    back?: string | null;
    signature?: string | null;
  }>({
    isOpen: false,
    name: '',
    nic: '',
    front: null,
    back: null,
    signature: null,
  });

  // Real-time duplicate cross-check against database when registering customer
  const normalizedInputNic = (nic || '').trim().toLowerCase();
  const normalizedInputPhone = (phone || '').replace(/\D/g, '');
  const isGovInputNic = isNationalId(normalizedInputNic);

  const duplicateClientMatch = (!editingClient && (normalizedInputNic.length >= 3 || normalizedInputPhone.length >= 9))
    ? clients.find(c => {
        const cBranch = normalizeBranchId(c.branch_id || c.branchId);
        const myBranch = normalizeBranchId(branchId);

        // If it's a book-era / non-NIC code (e.g. "3R 14543"), ONLY match within the user's active branch!
        // This ensures Kadawatha and Kiribathgoda will never conflict on duplicate book ledger IDs.
        if (!isGovInputNic && cBranch !== myBranch) {
          return false;
        }

        const rawNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
        const cleanRawNic = stripBranchPrefix(rawNic).toLowerCase();
        const cPhone = String(c.phone || c.mobile || '').replace(/\D/g, '');

        const nicMatches = normalizedInputNic.length >= 3 && (
          rawNic === normalizedInputNic || 
          cleanRawNic === normalizedInputNic ||
          rawNic.replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '') ||
          cleanRawNic.replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '')
        );
        const phoneMatches = normalizedInputPhone.length >= 9 && cPhone.length >= 9 && cPhone === normalizedInputPhone;

        return nicMatches || phoneMatches;
      })
    : null;

  const isDuplicateClientNic = Boolean(
    duplicateClientMatch && 
    normalizedInputNic.length >= 3 && 
    (
      String(duplicateClientMatch.national_id || duplicateClientMatch.nationalId || duplicateClientMatch.nic || duplicateClientMatch.id || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '') ||
      stripBranchPrefix(String(duplicateClientMatch.national_id || duplicateClientMatch.nationalId || duplicateClientMatch.nic || duplicateClientMatch.id || '')).trim().toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '')
    )
  );

  const isDuplicateClientPhone = Boolean(
    duplicateClientMatch && 
    normalizedInputPhone.length >= 9 && 
    String(duplicateClientMatch.phone || duplicateClientMatch.mobile || '').replace(/\D/g, '') === normalizedInputPhone
  );

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setBranches([{ id: 'ALL', name: 'All Branches' }, ...data]);
      }
    } catch (e) {
      console.error('Failed to load branches', e);
    }
  };

  const loadClients = async (overrideBranch?: string) => {
    try {
      setLoading(true);
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const user = JSON.parse(storedUser);
          setBranchId(user.branchId || 'HQ');
          setUserId(user.id || '');
          setUserRole(user.role || 'TELLER');
        } catch {}
      }

      // getAuthHeaders() automatically includes Authorization + x-branch-id from localStorage
      const headers = getAuthHeaders();
      const targetBranch = overrideBranch !== undefined ? overrideBranch : selectedBranchFilter;
      const queryParam = targetBranch && targetBranch !== 'ALL' ? `?branchId=${encodeURIComponent(targetBranch)}` : '';

      const res = await fetch(`/api/clients${queryParam}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setClients(Array.isArray(data) ? data : []);
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn("Client directory fetch response:", res.status, errJson);
        toast.error(errJson.error || "Failed to load customer directory. Please retry.");
      }
    } catch(err: any) {
      console.error("Client directory network error:", err);
      toast.error("Network connection issue while loading customer directory.");
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerData = async () => {
    try {
      let query = supabase.from('stock_customers').select('*');
      const targetBranch = selectedBranchFilter !== 'ALL' ? selectedBranchFilter : (branchId && branchId !== 'HQ' && branchId !== 'ALL' ? branchId : null);
      if (targetBranch) {
        const terms = getBranchSearchTerms(targetBranch);
        const orClause = terms.map(t => `branch_id.ilike.%${t}%`).join(',');
        query = query.or(orClause);
      }
      const { data, error } = await query.order('name', { ascending: true });
      if (error) throw error;
      setStockCustomers(data || []);
      setIsUsingSupabase(true);
    } catch (err) {
      console.warn("Failed to fetch stock customers from Supabase, loading LocalStorage:", err);
      setIsUsingSupabase(false);
      const local = localStorage.getItem('local_stock_customers');
      if (local) {
        try {
          const allItems = JSON.parse(local);
          setStockCustomers(allItems);
        } catch (e) {
          setStockCustomers([]);
        }
      } else {
        setStockCustomers([]);
      }
    }
  };

  useEffect(() => {
    loadClients('ALL');
    loadCustomerData();
    loadBranches();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('register') === 'true') {
        setIsOpen(true);
        const nicParam = params.get('nic');
        if (nicParam) {
          setNic(nicParam);
        }
      } else if (params.get('register_existing') === 'true') {
        const billParam = params.get('bill') || "";
        openAddCustomerModal(billParam);
      }
    }
  }, []);

  const openAgreementDialog = (client: any) => {
    setAgreementClientNum(client.nic || `CLI-${client.id.substring(0, 6)}`.toUpperCase());
    setAgreementDate(new Date().toISOString().split('T')[0]);
    setAgreementBorrowerName(client.first_name || client.firstName || "");
    setAgreementNic(client.nic || "");
    setAgreementAddress(client.address || "");
    setAgreementLoanLimit("100000");
    setAgreementServiceFee("3.5");
    setAgreementInterest("0");
    setAgreementCode("");
    setShowAgreementModal(true);
  };

  const handleGenerateAgreement = () => {
    if (!agreementCode.trim()) {
      toast.error("SMS Verification Code is required to sign the agreement.");
      return;
    }
    printLoanAgreement({
      clientNumber: agreementClientNum,
      agreementDate: agreementDate,
      borrowerName: agreementBorrowerName,
      nicNumber: agreementNic,
      address: agreementAddress,
      loanLimit: agreementLoanLimit,
      serviceFee: agreementServiceFee,
      interestRate: agreementInterest,
      verificationCode: agreementCode
    });
    setShowAgreementModal(false);
  };

  const handleSave = async () => {
    if (isSaving) return;

    // If duplicate customer detected when registering new, switch to edit mode
    if (duplicateClientMatch && !editingClient) {
      toast.info(`Customer already exists in database. Switched to existing record for ${duplicateClientMatch.first_name || duplicateClientMatch.firstName || 'Customer'}`);
      openEditDialog(duplicateClientMatch);
      return;
    }

    if (!nic || !firstName) {
      toast.error("Missing Information", {
        description: "NIC and Name with Initials are required."
      });
      return;
    }

    const phoneDigits = (phone || '').replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length < 10) {
      toast.error("invalid mobile number", {
        description: "Mobile number must be at least 10 digits."
      });
      return;
    }

    if (!nicFrontImage || !nicBackImage || !signatureImage) {
      toast.error("capture the pictures", {
        description: "Please capture NIC Front, NIC Back, and Signature pictures before proceeding."
      });
      if (!nicFrontImage) setActiveKycTab('nic_front');
      else if (!nicBackImage) setActiveKycTab('nic_back');
      else if (!signatureImage) setActiveKycTab('signature');
      return;
    }

    setIsSaving(true);
    const toastId = toast.loading(editingClient ? "Updating customer profile..." : "Saving customer profile...");

    try {
      const url = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PATCH' : 'POST';

      // Serialize Front and Back NIC scan base64 frames into a single robust JSON payload string
      const serializedNicImage = JSON.stringify({ front: nicFrontImage, back: nicBackImage });

      const headers = getAuthHeaders();

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({ 
          nic, 
          firstName, // Name with Initials
          lastName: '.',
          phone, 
          address,
          nicImage: serializedNicImage,
          signatureImage,
          branchId, 
          createdByUserId: userId 
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save");
      }

      toast.success(editingClient ? "Customer updated successfully!" : "Customer saved successfully!", { id: toastId });
      
      setIsOpen(false);
      setEditingClient(null);
      setNic(''); setFirstName(''); setPhone(''); setAddress('');
      setNicFrontImage(null); setNicBackImage(null); setSignatureImage(null);
      setActiveKycTab('nic_front');
      await loadClients();
    } catch(err: any) {
      console.error(err);
      toast.error("Error saving customer", {
        description: err.message || "Please check your network connection.",
        id: toastId
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openEditDialog = (client: any) => {
    setEditingClient(client);
    setNic(client.national_id || client.nationalId || '');
    setFirstName(client.first_name || client.firstName || '');
    setPhone(client.phone || '');
    setAddress(client.address || '');
    
    let front = null;
    let back = null;
    if (client.nic_image) {
      try {
        const parsed = JSON.parse(client.nic_image);
        front = parsed.front || null;
        back = parsed.back || null;
      } catch (e) {
        front = client.nic_image; // Fallback legacy format support
      }
    }
    setNicFrontImage(front);
    setNicBackImage(back);
    setSignatureImage(client.signature_image || null);
    setActiveKycTab('nic_front');
    setIsOpen(true);
  };

  const handleDelete = async (client: any) => {
    if (!confirm(`Are you sure you want to remove ${client.first_name || client.firstName}?`)) return;

    const toastId = toast.loading("Deleting customer...");
    try {
      const headers = getAuthHeaders();

      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Customer removed successfully", { id: toastId });
      loadClients();
    } catch (err) {
      toast.error("Could not delete customer", { id: toastId });
    }
  };

  // Existing Shop Bills Customer operations & logic
  const handleAddBillPrefix = (prefix: string) => {
    const trimmed = custBills.trim();
    if (!trimmed) {
      setCustBills(prefix + " ");
    } else if (trimmed.endsWith(",")) {
      setCustBills(custBills + " " + prefix + " ");
    } else {
      setCustBills(custBills + ", " + prefix + " ");
    }
  };

  const openAddCustomerModal = (initialBill = "") => {
    setSelectedCustomer(null);
    setCustName("");
    setCustAddress("");
    setCustAddress2("");
    setCustTp("");
    setCustNic("");
    setCustBills(initialBill);
    setIsEditingCustomer(false);
    setShowAddCustomerModal(true);
  };

  const openEditCustomerModal = (customer: any) => {
    setSelectedCustomer(customer);
    setCustName(customer.name);
    setCustAddress(customer.address);
    setCustAddress2(customer.address_2 || "");
    setCustTp(customer.tp);
    setCustNic(customer.nic || "");
    setCustBills(customer.bill_numbers || "");
    setIsEditingCustomer(true);
    setShowAddCustomerModal(true);
  };

  const handleNameChange = (val: string) => {
    setCustName(val);
    if (!val.trim()) {
      setNameSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const matches = stockCustomers.filter(c => 
      c.name.toLowerCase().includes(val.toLowerCase())
    );
    setNameSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  };

  const selectNameSuggestion = (suggestion: any) => {
    setCustName(suggestion.name);
    setCustAddress(suggestion.address);
    setCustAddress2(suggestion.address_2 || "");
    setCustTp(suggestion.tp);
    setCustNic(suggestion.nic || "");
    if (!custBills.trim()) {
      setCustBills(suggestion.bill_numbers || "");
    }
    setShowSuggestions(false);
    setNameSuggestions([]);
  };

  const handleSaveCustomer = async () => {
    if (!custName.trim() || !custAddress.trim() || !custTp.trim()) {
      toast.error("Name, Address, and Telephone are required fields.");
      return;
    }

    const payload = {
      name: custName.trim(),
      address: custAddress.trim(),
      address_2: custAddress2.trim() || null,
      tp: custTp.trim(),
      nic: custNic.trim() || null,
      bill_numbers: custBills.trim(),
      branch_id: normalizeBranchId(branchId || 'HQ')
    };

    try {
      if (isUsingSupabase) {
        if (isEditingCustomer && selectedCustomer) {
          const { error } = await supabase
            .from('stock_customers')
            .update(payload)
            .eq('id', selectedCustomer.id);
          if (error) throw error;
          toast.success("Customer profile updated successfully!");
        } else {
          const { error } = await supabase
            .from('stock_customers')
            .insert([payload]);
          if (error) throw error;
          toast.success("Customer profile created successfully!");
        }
      } else {
        const local = localStorage.getItem('local_stock_customers');
        let list: any[] = [];
        if (local) {
          try { list = JSON.parse(local); } catch (e) {}
        }
        if (isEditingCustomer && selectedCustomer) {
          list = list.map(c => c.id === selectedCustomer.id ? { ...c, ...payload } : c);
          toast.success("Customer profile updated successfully!");
        } else {
          const newCust = {
            id: Math.random().toString(36).substring(2, 9),
            ...payload,
            created_at: new Date().toISOString()
          };
          list = [newCust, ...list];
          toast.success("Customer profile created successfully!");
        }
        localStorage.setItem('local_stock_customers', JSON.stringify(list));
      }
      setShowAddCustomerModal(false);
      loadCustomerData();
    } catch (err: any) {
      toast.error("Error saving customer profile: " + err.message);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer profile?")) return;
    try {
      if (isUsingSupabase) {
        const headers = getAuthHeaders();
        const res = await fetch(`/api/stock-customers/${id}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error("Delete failed");
        toast.success("Customer profile deleted from Supabase!");
      } else {
        const local = localStorage.getItem('local_stock_customers');
        if (local) {
          const list = JSON.parse(local).filter((c: any) => c.id !== id);
          localStorage.setItem('local_stock_customers', JSON.stringify(list));
        }
        toast.success("Customer profile deleted (Local Storage)!");
      }
      loadCustomerData();
    } catch (err: any) {
      toast.error("Error deleting customer: " + err.message);
    }
  };

  const filteredClients = clients.filter(client => {
    // 1. Branch filter
    if (selectedBranchFilter && selectedBranchFilter !== 'ALL') {
      const cBranch = String(client.branch_id || client.branchId || '').toUpperCase().trim();
      const sBranch = selectedBranchFilter.toUpperCase().trim();
      const terms = getBranchSearchTerms(sBranch);
      const branchMatches = terms.some(t => cBranch === t.toUpperCase() || cBranch.includes(t.toUpperCase())) || cBranch === sBranch;
      if (!branchMatches) return false;
    }

    // 2. Search query filter
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();

    return (
      (client.first_name || client.firstName)?.toLowerCase().includes(q) ||
      (client.last_name || client.lastName)?.toLowerCase().includes(q) ||
      (client.national_id || client.nationalId)?.toLowerCase().includes(q) ||
      (client.display_national_id || stripBranchPrefix(client.national_id || client.nationalId))?.toLowerCase().includes(q) ||
      client.address?.toLowerCase().includes(q) ||
      (client.branch_id || client.branchId)?.toLowerCase().includes(q) ||
      client.phone?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-2xl border-white/40 shadow-2xl gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-none mb-2">Our <span className="text-gradient">Customers</span></h1>
          <p className="text-slate-500 font-medium tracking-tight">View and manage all customer details across all branches.</p>
        </div>
      </div>

      {/* Photo Capture & KYC Verification KPI & Coverage Chart */}
      {(() => {
        const total = clients.length;
        const withAnyPhoto = clients.filter(c => {
          if (c.signature_image || c.signatureImage) return true;
          const raw = c.nic_image || c.nicImage;
          if (!raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!(p.front || p.back);
          } catch {
            return typeof raw === 'string' && raw.length > 20;
          }
        }).length;

        const withFront = clients.filter(c => {
          const raw = c.nic_image || c.nicImage;
          if (!raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!p.front;
          } catch {
            return typeof raw === 'string' && raw.length > 20;
          }
        }).length;

        const withBack = clients.filter(c => {
          const raw = c.nic_image || c.nicImage;
          if (!raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!p.back;
          } catch {
            return false;
          }
        }).length;

        const withSign = clients.filter(c => !!(c.signature_image || c.signatureImage)).length;

        const withFullKyc = clients.filter(c => {
          const hasSign = !!(c.signature_image || c.signatureImage);
          const raw = c.nic_image || c.nicImage;
          if (!hasSign || !raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!(p.front && p.back);
          } catch {
            return false;
          }
        }).length;

        const coveragePct = total > 0 ? Math.round((withAnyPhoto / total) * 100) : 0;
        const fullKycPct = total > 0 ? Math.round((withFullKyc / total) * 100) : 0;
        const frontPct = total > 0 ? Math.round((withFront / total) * 100) : 0;
        const backPct = total > 0 ? Math.round((withBack / total) * 100) : 0;
        const signPct = total > 0 ? Math.round((withSign / total) * 100) : 0;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Customers */}
            <div className="glass p-5 rounded-2xl border border-white/60 shadow-lg bg-white/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total Directory</span>
                <div className="p-2 bg-slate-100 rounded-xl text-slate-700">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-slate-900 tracking-tight">{total}</div>
                <div className="text-xs font-bold text-slate-400 mt-0.5">Registered Borrowers</div>
              </div>
            </div>

            {/* Photos Captured */}
            <div className="glass p-5 rounded-2xl border border-emerald-100 shadow-lg bg-emerald-50/40 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800">Photos Captured</span>
                <div className="p-2 bg-emerald-100 rounded-xl text-emerald-700">
                  <Camera className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-emerald-950 tracking-tight">{withAnyPhoto}</div>
                <div className="text-xs font-bold text-emerald-700 mt-0.5">{total - withAnyPhoto} Pending Capture</div>
              </div>
            </div>

            {/* Complete 3-Point KYC */}
            <div className="glass p-5 rounded-2xl border border-blue-100 shadow-lg bg-blue-50/40 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-800">3-Point Verified KYC</span>
                <div className="p-2 bg-blue-100 rounded-xl text-blue-700">
                  <ShieldCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-blue-950 tracking-tight">{withFullKyc}</div>
                <div className="text-xs font-bold text-blue-700 mt-0.5">{fullKycPct}% Complete (Front + Back + Sign)</div>
              </div>
            </div>

            {/* Verification Coverage Chart */}
            <div className="glass p-5 rounded-2xl border border-amber-100 shadow-lg bg-gradient-to-br from-white/90 to-amber-50/60 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">Photo Coverage</span>
                <span className="text-sm font-black text-amber-900 font-mono">{coveragePct}%</span>
              </div>
              <div className="space-y-2">
                <div className="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden flex">
                  <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${coveragePct}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-1 pt-1 text-[9px] font-bold text-slate-500 text-center">
                  <div className="bg-white/80 py-1 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[8px]">FRONT</span>
                    <span className="font-mono text-slate-800 font-black">{frontPct}%</span>
                  </div>
                  <div className="bg-white/80 py-1 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[8px]">BACK</span>
                    <span className="font-mono text-slate-800 font-black">{backPct}%</span>
                  </div>
                  <div className="bg-white/80 py-1 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[8px]">SIGN</span>
                    <span className="font-mono text-slate-800 font-black">{signPct}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}



      {/* New Customer Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[95vw] sm:w-[92vw] lg:max-w-4xl max-h-[90vh] bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col overflow-hidden">
          <div className="h-2 bg-primary animate-pulse shrink-0" />
          
          {/* Fixed Header */}
          <div className="p-4 sm:p-6 pb-3 border-b border-slate-100 shrink-0 bg-white">
            <DialogHeader>
              <DialogTitle className="text-xl sm:text-2xl font-black tracking-tighter flex items-center gap-2.5 sm:gap-3">
                 {editingClient ? <UserCog className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" /> : <UserPlus className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />}
                 <span>{editingClient ? "Edit Customer Record" : "Register New Customer"}</span>
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs sm:text-sm mt-1">
                {editingClient ? "Update current customer KYC and profile." : "Enter customer details and capture webcam images for KYC verification."}
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
              {/* Left Column: Form Inputs */}
              <div className="space-y-4">
                {/* ── RED ALERT: CUSTOMER ALREADY EXISTS IN DATABASE ── */}
                {duplicateClientMatch && (
                  <div className="bg-red-50 border-2 border-red-500 rounded-2xl p-4 sm:p-5 shadow-lg shadow-red-500/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-start justify-between gap-2 border-b border-red-200 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm font-black text-red-700 uppercase tracking-wide block">
                            Customer Already Exists in Database!
                          </span>
                          <span className="text-[11px] font-bold text-red-600">
                            Existing customer details are shown below in red:
                          </span>
                        </div>
                      </div>
                      <Badge className="bg-red-600 hover:bg-red-600 text-white font-mono font-black text-[10px] uppercase tracking-wider shrink-0 px-2.5 py-1">
                        EXISTS IN DB
                      </Badge>
                    </div>

                    {/* Existing Details Visible in Red Color */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Existing NIC Number
                        </span>
                        <span className="font-mono font-black text-red-700 text-sm">
                          {duplicateClientMatch.national_id || duplicateClientMatch.nationalId || duplicateClientMatch.id || nic}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Full Name
                        </span>
                        <span className="font-black text-red-700 text-sm">
                          {`${duplicateClientMatch.first_name || duplicateClientMatch.firstName || ''} ${duplicateClientMatch.last_name || duplicateClientMatch.lastName || ''}`.trim() || duplicateClientMatch.name || 'Unnamed Client'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Mobile Number (TP)
                        </span>
                        <span className="font-mono font-black text-red-700 text-sm">
                          {duplicateClientMatch.phone || duplicateClientMatch.mobile || 'No Mobile Number'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Registered Branch
                        </span>
                        <span className="font-black text-red-700 text-xs uppercase">
                          {duplicateClientMatch.branch_id || duplicateClientMatch.branchId || 'Head Office / HQ'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm sm:col-span-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Permanent Address
                        </span>
                        <span className="font-bold text-red-700 text-xs">
                          {duplicateClientMatch.address || duplicateClientMatch.address_line1 || 'No Address Recorded'}
                        </span>
                      </div>
                    </div>

                    {/* Action button inside red card */}
                    <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-red-600">
                        Click below to view or edit this customer profile:
                      </span>
                      <Button
                        type="button"
                        onClick={() => {
                          openEditDialog(duplicateClientMatch);
                          toast.info('Switched to existing customer record ✓');
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider h-9 px-4 rounded-xl shadow-md gap-1.5 cursor-pointer shrink-0"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Edit Existing Record</span>
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="nic" 
                      className={`font-black text-[10px] uppercase tracking-widest ${isDuplicateClientNic ? 'text-red-600' : 'text-slate-400'}`}
                    >
                      NIC Number (Primary Key)
                    </Label>
                    {isDuplicateClientNic && (
                      <span className="text-[10px] font-black text-red-600 flex items-center gap-1 uppercase tracking-wider animate-pulse">
                        <AlertTriangle className="w-3 h-3 stroke-[2.5]" /> Exists in DB
                      </span>
                    )}
                  </div>
                  <Input 
                    value={nic} 
                    onChange={e=>setNic(e.target.value)} 
                    id="nic" 
                    placeholder="e.g. 941234567V or 199412345678" 
                    className={`h-11 rounded-xl font-mono font-bold text-xs sm:text-sm transition-all ${
                      isDuplicateClientNic 
                        ? 'border-2 border-red-500 bg-red-50/70 text-red-700 focus:border-red-600 focus:ring-red-400/20' 
                        : 'bg-white/50 text-slate-800'
                    }`} 
                  />
                </div>
                
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="firstName" className="font-black text-[10px] uppercase tracking-widest text-slate-400">Name with Initials</Label>
                    {duplicateClientMatch && (
                      <span className="text-[10px] font-bold text-red-600">
                        Existing: {`${duplicateClientMatch.first_name || duplicateClientMatch.firstName || ''} ${duplicateClientMatch.last_name || duplicateClientMatch.lastName || ''}`.trim()}
                      </span>
                    )}
                  </div>
                  <Input value={firstName} onChange={e=>setFirstName(e.target.value)} id="firstName" placeholder="e.g. A.B.C. Perera" className="h-11 bg-white/50 rounded-xl font-bold text-slate-800 text-xs sm:text-sm" />
                </div>

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="phone" 
                      className={`font-black text-[10px] uppercase tracking-widest ${isDuplicateClientPhone ? 'text-red-600' : 'text-slate-400'}`}
                    >
                      TP (Phone Number)
                    </Label>
                    <div className="flex items-center gap-2">
                      {isDuplicateClientPhone && (
                        <span className="text-[10px] font-black text-red-600 flex items-center gap-1 uppercase tracking-wider animate-pulse">
                          <AlertTriangle className="w-3 h-3 stroke-[2.5]" /> TP Matches Existing
                        </span>
                      )}
                      <span className={`text-[10px] font-bold ${(phone || '').replace(/\D/g, '').length === 10 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {(phone || '').replace(/\D/g, '').length}/10 digits
                      </span>
                    </div>
                  </div>
                  <Input 
                    value={phone} 
                    onChange={e => {
                      const val = e.target.value;
                      const digits = val.replace(/\D/g, '');
                      if (digits.length <= 10) {
                        setPhone(val);
                      }
                    }} 
                    id="phone" 
                    placeholder="e.g. 077 123 4567" 
                    className={`h-11 rounded-xl font-mono font-bold text-xs sm:text-sm transition-all ${
                      isDuplicateClientPhone 
                        ? 'border-2 border-red-500 bg-red-50/70 text-red-700 focus:border-red-600 focus:ring-red-400/20' 
                        : 'bg-white/50 text-slate-800'
                    }`} 
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="address" className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address</Label>
                  <textarea 
                    value={address} 
                    onChange={e=>setAddress(e.target.value)} 
                    id="address" 
                    placeholder="Enter customer permanent address..." 
                    className="w-full h-20 sm:h-24 p-3 bg-white/50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none" 
                  />
                </div>
              </div>

              {/* Right Column: Smart Tabbed Switcher (NIC Front, NIC Back, Signature) */}
              <div className="space-y-4">
                {/* Segmented Control Tabs */}
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 shadow-inner w-full">
                  <button
                    type="button"
                    onClick={() => setActiveKycTab('nic_front')}
                    className={`py-2 px-1 sm:px-3 text-[10px] sm:text-xs font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1 transition-all cursor-pointer rounded-lg ${
                      activeKycTab === 'nic_front'
                        ? 'bg-primary text-white shadow-md shadow-primary/20 scale-[1.02]'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                    }`}
                  >
                    <span className="whitespace-nowrap flex items-center gap-1">
                      <span>🪪</span> 
                      <span className="truncate">NIC Front</span>
                      {nicFrontImage ? (
                        <Check className="w-3 h-3 text-emerald-400 inline-block stroke-[3]" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveKycTab('nic_back')}
                    className={`py-2 px-1 sm:px-3 text-[10px] sm:text-xs font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1 transition-all cursor-pointer rounded-lg ${
                      activeKycTab === 'nic_back'
                        ? 'bg-primary text-white shadow-md shadow-primary/20 scale-[1.02]'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                    }`}
                  >
                    <span className="whitespace-nowrap flex items-center gap-1">
                      <span>🪪</span> 
                      <span className="truncate">NIC Back</span>
                      {nicBackImage ? (
                        <Check className="w-3 h-3 text-emerald-400 inline-block stroke-[3]" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveKycTab('signature')}
                    className={`py-2 px-1 sm:px-3 text-[10px] sm:text-xs font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1 transition-all cursor-pointer rounded-lg ${
                      activeKycTab === 'signature'
                        ? 'bg-primary text-white shadow-md shadow-primary/20 scale-[1.02]'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                    }`}
                  >
                    <span className="whitespace-nowrap flex items-center gap-1">
                      <span>✍️</span> 
                      <span className="truncate">Signature</span>
                      {signatureImage ? (
                        <Check className="w-3 h-3 text-emerald-400 inline-block stroke-[3]" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      )}
                    </span>
                  </button>
                </div>

                {/* Webcam capture widget container with autoStart */}
                <div className="min-h-[220px]">
                  {activeKycTab === 'nic_front' && (
                    <WebcamCapture 
                      key="nic_front_capture"
                      label="NIC Front Side Scan" 
                      onCapture={(base64) => setNicFrontImage(base64)} 
                      initialImage={nicFrontImage} 
                      autoStart={true}
                    />
                  )}

                  {activeKycTab === 'nic_back' && (
                    <WebcamCapture 
                      key="nic_back_capture"
                      label="NIC Back Side Scan" 
                      onCapture={(base64) => setNicBackImage(base64)} 
                      initialImage={nicBackImage} 
                      autoStart={true}
                    />
                  )}

                  {activeKycTab === 'signature' && (
                    <WebcamCapture 
                      key="signature_capture"
                      label="Signature Camera Scan" 
                      onCapture={(base64) => setSignatureImage(base64)} 
                      initialImage={signatureImage} 
                      autoStart={true}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="p-4 sm:p-6 pt-3 border-t border-slate-100/80 bg-slate-50/80 shrink-0 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 w-full sm:w-auto">
              {(!nicFrontImage || !nicBackImage || !signatureImage) ? (
                <span className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200/80 px-3 py-1.5 rounded-xl text-[11px] font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Pictures required: {!nicFrontImage ? 'NIC Front' : ''} {!nicBackImage ? (!nicFrontImage ? '• NIC Back' : 'NIC Back') : ''} {!signatureImage ? (!nicFrontImage || !nicBackImage ? '• Signature' : 'Signature') : ''}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 rounded-xl text-[11px] font-bold">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 stroke-[3]" />
                  <span>All 3 KYC pictures captured</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button variant="ghost" className="font-bold text-slate-500 h-11 sm:h-12 rounded-xl w-full sm:w-auto" onClick={() => { setIsOpen(false); setEditingClient(null); }}>Cancel</Button>
              <Button 
                disabled={isSaving}
                onClick={handleSave} 
                className={`${
                  duplicateClientMatch
                    ? "bg-red-600 hover:bg-red-700 text-white shadow-red-600/20"
                    : "bg-primary hover:bg-primary/90 text-white shadow-primary/20"
                } font-black px-8 h-11 sm:h-12 rounded-xl shadow-lg gap-2 cursor-pointer w-full sm:w-auto transition-all`}
              >
                {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : null}
                {isSaving 
                  ? "Saving Record..." 
                  : duplicateClientMatch 
                    ? "Customer Exists - Switch to Edit" 
                    : (editingClient ? "Update Customer" : "Register Customer")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Directory Controls */}
      <div className="flex flex-col md:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all customers by Name, NIC, TP, Address, or Branch..." 
            className="pl-12 h-14 bg-white/50 border-white/40 glass focus:ring-primary shadow-lg shadow-slate-200/50 rounded-2xl font-bold" 
          />
        </div>
        <div className="relative w-full md:w-auto shrink-0 min-w-[220px]">
          <select
            value={selectedBranchFilter}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedBranchFilter(val);
              loadClients(val);
            }}
            className="h-14 w-full px-5 pr-10 bg-white/80 border border-slate-200 glass font-black text-xs uppercase tracking-wider text-slate-700 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer appearance-none"
          >
            <option value="ALL">All Branches ({clients.length})</option>
            {branches.filter(b => b.id !== 'ALL').map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id} Branch
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
            <Filter className="w-4 h-4 text-primary" />
          </div>
        </div>
        <Button 
          onClick={() => setIsOpen(true)} 
          className="gap-2 bg-primary hover:bg-primary/90 h-14 px-8 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 card-hover w-full md:w-auto shrink-0 transition-all rounded-2xl cursor-pointer"
        >
          <UserPlus className="h-4 w-4" /> Add New Customer
        </Button>
      </div>

      {/* Table Section */}
      <div className="w-full overflow-x-auto glass border-white/40 rounded-[2.5rem] shadow-2xl min-h-[500px] flex flex-col bg-white/40">
        <Table>
          <TableHeader className="bg-slate-50/50 border-b border-slate-100">
            <TableRow>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">NIC Number</TableHead>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Name & TP</TableHead>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch</TableHead>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Address</TableHead>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Webcam KYC Scans</TableHead>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Status</TableHead>
              <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Joined Date</TableHead>
              <TableHead className="px-8 py-5"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-50">
            {loading ? (
               <TableRow><TableCell colSpan={8} className="h-64 text-center font-black text-slate-300 animate-pulse tracking-widest uppercase">Initializing directory metadata...</TableCell></TableRow>
            ) : filteredClients.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={8} className="h-64 text-center">
                    <p className="text-slate-400 font-bold mb-4">No customer fingerprints detected.</p>
                    <Button variant="outline" onClick={() => setIsOpen(true)} className="border-primary/20 text-primary font-black text-[10px] uppercase tracking-widest h-12 rounded-xl hover:bg-primary hover:text-white transition-all px-8">Generate First Entry</Button>
                 </TableCell>
               </TableRow>
            ) : (
              filteredClients.map((client) => (
                <TableRow key={client.id} className="group hover:bg-primary/5 transition-all duration-300">
                  <TableCell className="px-8 py-6 font-black text-slate-900 group-hover:text-primary transition-colors underline decoration-primary/10 underline-offset-4">
                    {client.display_national_id || stripBranchPrefix(client.national_id || client.nationalId) || 'N/A'}
                  </TableCell>
                  <TableCell className="px-8 py-6">
                    <div className="flex flex-col">
                      {(() => {
                        const rawName = (client.first_name || client.firstName || '').trim();
                        const lastName = (client.last_name || client.lastName || '').trim();
                        const isPlaceholder = !rawName || rawName === 'Valued Customer' || rawName === '.';
                        const fullName = isPlaceholder ? '' : [rawName, lastName === '.' ? '' : lastName].filter(Boolean).join(' ');
                        return isPlaceholder ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 border border-dashed border-slate-300 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">No Name</span>
                        ) : (
                          <span className="font-bold text-slate-800 leading-none mb-1">{fullName}</span>
                        );
                      })()}
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{client.phone || 'No Phone'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-8 py-6">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 border border-slate-200/80 font-black text-[10px] uppercase tracking-wider text-slate-700 shadow-xs">
                      <MapPin className="w-3 h-3 text-primary shrink-0" />
                      <span>{client.branch_id || client.branchId || 'HQ'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-8 py-6 max-w-[200px] truncate text-slate-500 font-bold text-xs">{client.address || 'No Address'}</TableCell>
                  <TableCell className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      {(() => {
                        let nicFront = null;
                        let nicBack = null;
                        if (client.nic_image) {
                          try {
                            const parsed = JSON.parse(client.nic_image);
                            nicFront = parsed.front || null;
                            nicBack = parsed.back || null;
                          } catch (e) {
                            nicFront = client.nic_image; // Fallback legacy format support
                          }
                        }
                        const openViewer = () => {
                          setPhotoViewerClient({
                            isOpen: true,
                            name: `${client.first_name || client.firstName || ''} ${client.last_name || client.lastName || ''}`.trim() || 'Customer',
                            nic: client.national_id || client.nationalId || 'N/A',
                            front: nicFront,
                            back: nicBack,
                            signature: client.signature_image || null,
                          });
                        };

                        return (
                          <>
                            {nicFront ? (
                              <div 
                                onClick={openViewer}
                                className="relative group/thumb cursor-pointer"
                                title="Click to view full photo"
                              >
                                <img 
                                  src={nicFront} 
                                  alt="NIC Front" 
                                  className="w-10 h-8 rounded-lg object-cover border border-slate-200 shadow-sm transition-transform group-hover/thumb:scale-125 group-hover/thumb:z-50"
                                />
                                <span className="bg-slate-900/90 text-white text-[8px] font-black uppercase tracking-widest px-1 py-0.5 rounded absolute -bottom-1.5 -right-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity">FRONT</span>
                              </div>
                            ) : (
                              <div className="w-10 h-8 bg-slate-100 rounded-lg flex items-center justify-center border border-dashed border-slate-200" title="No NIC Front Scan">
                                <CameraOff className="w-3.5 h-3.5 text-slate-300" />
                              </div>
                            )}

                            {nicBack ? (
                              <div 
                                onClick={openViewer}
                                className="relative group/thumb cursor-pointer"
                                title="Click to view full photo"
                              >
                                <img 
                                  src={nicBack} 
                                  alt="NIC Back" 
                                  className="w-10 h-8 rounded-lg object-cover border border-slate-200 shadow-sm transition-transform group-hover/thumb:scale-125 group-hover/thumb:z-50"
                                />
                                <span className="bg-slate-900/90 text-white text-[8px] font-black uppercase tracking-widest px-1 py-0.5 rounded absolute -bottom-1.5 -right-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity">BACK</span>
                              </div>
                            ) : (
                              <div className="w-10 h-8 bg-slate-100 rounded-lg flex items-center justify-center border border-dashed border-slate-200" title="No NIC Back Scan">
                                <CameraOff className="w-3.5 h-3.5 text-slate-300" />
                              </div>
                            )}

                            {client.signature_image ? (
                              <div 
                                onClick={openViewer}
                                className="relative group/thumb cursor-pointer"
                                title="Click to view signature"
                              >
                                <img 
                                  src={client.signature_image} 
                                  alt="Signature Preview" 
                                  className="w-10 h-8 rounded-lg object-cover border border-slate-200 shadow-sm transition-transform group-hover/thumb:scale-125 group-hover/thumb:z-50"
                                />
                                <span className="bg-slate-900/90 text-white text-[8px] font-black uppercase tracking-widest px-1 py-0.5 rounded absolute -bottom-1.5 -right-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity">SIG</span>
                              </div>
                            ) : (
                              <div className="w-10 h-8 bg-slate-100 rounded-lg flex items-center justify-center border border-dashed border-slate-200" title="No Signature Webcam Scan">
                                <CameraOff className="w-3.5 h-3.5 text-slate-300" />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="px-8 py-6">
                    {(() => {
                      let hasFront = false;
                      let hasBack = false;
                      if (client.nic_image) {
                        try {
                          const parsed = JSON.parse(client.nic_image);
                          hasFront = !!parsed.front;
                          hasBack = !!parsed.back;
                        } catch (e) {
                          hasFront = true; // Legacy fallback is marked complete
                          hasBack = true;
                        }
                      }
                      const kycComplete = hasFront && hasBack && !!client.signature_image;
                      return (
                        <Badge className={`border font-black text-[9px] uppercase tracking-widest px-3 ${
                          kycComplete
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}>
                          {kycComplete ? 'KYC Verified' : 'Pending KYC'}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-8 py-6 text-slate-500 font-bold text-xs uppercase tracking-widest">
                    {(client.created_at || client.createdAt) ? new Date(client.created_at || client.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                  </TableCell>
                  <TableCell className="px-8 py-6 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="text-slate-300 hover:text-primary hover:bg-primary/10 transition-all h-10 w-10 rounded-xl inline-flex items-center justify-center border-none bg-transparent cursor-pointer outline-none">
                         <MoreVertical className="w-4 h-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 glass p-2 rounded-2xl border-white/40 shadow-2xl">
                        <div className="px-4 py-2 font-black text-[9px] uppercase tracking-widest text-slate-400">Operations</div>
                        <DropdownMenuSeparator className="bg-slate-100/50" />
                        <DropdownMenuItem onClick={() => openEditDialog(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer outline-none">
                          <Pencil className="w-4 h-4" /> Edit Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAgreementDialog(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer outline-none">
                          <FileText className="w-4 h-4 text-blue-600" /> Loan Agreement
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer">
                          <Trash2 className="w-4 h-4" /> Delete Record
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* MODAL: CUSTOMER REGISTRY */}
      <Dialog open={showCustomerRegistryModal} onOpenChange={setShowCustomerRegistryModal}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[750px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-2xl sm:rounded-[2.5rem] max-h-[85vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-4 sm:p-6 pb-2 shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <DialogHeader>
              <DialogTitle className="text-xl sm:text-2xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 text-blue-600 shrink-0">
                  <Users className="h-5 w-5" />
                </div>
                <span>Customer Registry</span>
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs sm:text-sm">
                Manage profile details and associated bill numbers for active vault customers.
              </DialogDescription>
            </DialogHeader>
            <Button 
              onClick={() => openAddCustomerModal("")}
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-9 px-4 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md w-full sm:w-auto justify-center"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add Profile
            </Button>
          </div>

          {/* Search bar inside Registry */}
          <div className="px-4 sm:px-6 py-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search customers by name, phone or NIC..." 
                className="pl-9 h-9 rounded-xl bg-slate-50 border-slate-200 font-medium text-xs"
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2">
            {(() => {
              const filtered = stockCustomers.filter(c => 
                (c.name || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.tp || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.nic || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.address || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.bill_numbers || "").toLowerCase().includes(customerSearchQuery.toLowerCase())
              );

              if (loading) {
                return <div className="py-12 text-center text-xs font-bold text-slate-400 animate-pulse">Loading active vault customer records...</div>;
              }

              if (filtered.length === 0) {
                return <div className="py-12 text-center text-xs font-bold text-slate-400">No registered vault customers found.</div>;
              }

              return (
                <div className="space-y-3 pb-6">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400">Customer</TableHead>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400">Contact</TableHead>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400">Bills Associated</TableHead>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(cust => (
                        <TableRow key={cust.id} className="hover:bg-slate-50/80">
                          <TableCell className="font-bold text-xs">
                            <div className="text-slate-900">{cust.name}</div>
                            {cust.nic && <div className="text-[10px] font-mono text-slate-400">{cust.nic}</div>}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-mono text-slate-700">{cust.tp || 'N/A'}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{cust.address || ''}</div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {cust.bill_numbers ? (
                              <div className="flex flex-wrap gap-1 max-w-[200px]">
                                {cust.bill_numbers.split(',').map((b: string, i: number) => (
                                  <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[9px] font-mono font-bold">
                                    {b.trim()}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-300 italic">No bills linked</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditCustomerModal(cust)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-blue-600 rounded-lg"
                                title="Edit Customer Profile"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteCustomer(cust.id)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 rounded-lg"
                                title="Delete Customer Profile"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })()}
          </div>

          <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
            <Button onClick={() => setShowCustomerRegistryModal(false)} className="rounded-xl font-bold w-full sm:w-auto">Close Registry</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: ADD/EDIT CUSTOMER */}
      <Dialog open={showAddCustomerModal} onOpenChange={setShowAddCustomerModal}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[480px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-2xl sm:rounded-[2.5rem] max-h-[90vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-4 sm:p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-9 w-9 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100 text-blue-600 shrink-0">
                  <UserPlus className="h-4.5 w-4.5" />
                </div>
                <span>{isEditingCustomer ? "Edit Customer Profile" : "Register Customer Profile"}</span>
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs">
                Associate customer contact details and addresses with active vault stock bills.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 space-y-4">
            <div className="grid gap-4 pb-4">
              
              {/* Customer Name */}
              <div className="grid gap-1.5 relative">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Customer Name</Label>
                <div className="relative">
                  <Input 
                    value={custName} 
                    onChange={e => handleNameChange(e.target.value)} 
                    placeholder="E.g. Saman Kumara" 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                  {showSuggestions && nameSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] max-h-40 overflow-y-auto divide-y divide-slate-100">
                      {nameSuggestions.map(suggestion => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => selectNameSuggestion(suggestion)}
                          className="w-full text-left px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors animate-in fade-in"
                        >
                          <div className="font-black text-slate-900">{suggestion.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{suggestion.tp} | {suggestion.address}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Telephone */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Telephone (TP)</Label>
                <Input 
                  value={custTp} 
                  onChange={e => setCustTp(e.target.value)} 
                  placeholder="E.g. 0771234567" 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              {/* NIC */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">NIC (Optional)</Label>
                <Input 
                  value={custNic} 
                  onChange={e => setCustNic(e.target.value)} 
                  placeholder="E.g. 941234567V" 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              {/* Address */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address</Label>
                <Input 
                  value={custAddress} 
                  onChange={e => setCustAddress(e.target.value)} 
                  placeholder="E.g. No 12, Main Street, Wattala" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* Address 2 */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address Line 2 (Optional)</Label>
                <Input 
                  value={custAddress2} 
                  onChange={e => setCustAddress2(e.target.value)} 
                  placeholder="E.g. Apartment 4B" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* Bill Numbers */}
              <div className="grid gap-1.5">
                <div className="flex justify-between items-center">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Linked Pawn Bill Numbers</Label>
                  <div className="flex items-center gap-1">
                    {["A", "1R", "3M", "3R", "6R", "12R", "6M"].map(pref => (
                      <button
                        key={pref}
                        type="button"
                        onClick={() => handleAddBillPrefix(pref)}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-[9px] font-black text-slate-700 cursor-pointer transition-colors active:scale-95"
                      >
                        {pref}
                      </button>
                    ))}
                  </div>
                </div>
                <Input 
                  value={custBills} 
                  onChange={e => setCustBills(e.target.value)} 
                  placeholder="Comma separated: e.g. 1R 15580, 12R 20750" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
                <span className="text-[9px] font-bold text-slate-400">Associate one or multiple bill numbers to this customer profile.</span>
              </div>

            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowAddCustomerModal(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button 
              onClick={handleSaveCustomer} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-5 rounded-xl shadow-lg cursor-pointer"
            >
              Save Customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: DIGITAL LOAN AGREEMENT SIGNER */}
      <Dialog open={showAgreementModal} onOpenChange={setShowAgreementModal}>
        <DialogContent className="sm:max-w-[500px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem] max-h-[90vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-9 w-9 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100 text-blue-600">
                  <FileText className="h-4.5 w-4.5" />
                </div>
                Digital Loan Agreement Signer
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs">
                Fill in the details to customize and electronically sign the 11-page Loan Agreement document.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            <div className="grid gap-4 pb-4">
              
              {/* Client / Agreement Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Agreement Date</Label>
                  <Input 
                    type="date"
                    value={agreementDate} 
                    onChange={e => setAgreementDate(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Client Number / Code</Label>
                  <Input 
                    value={agreementClientNum} 
                    onChange={e => setAgreementClientNum(e.target.value)} 
                    placeholder="E.g. CLI-002"
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
              </div>

              {/* Borrower Details */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Borrower Full Name</Label>
                <Input 
                  value={agreementBorrowerName} 
                  onChange={e => setAgreementBorrowerName(e.target.value)} 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">NIC Number</Label>
                  <Input 
                    value={agreementNic} 
                    onChange={e => setAgreementNic(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Approved Loan Limit (LKR)</Label>
                  <Input 
                    type="number"
                    value={agreementLoanLimit} 
                    onChange={e => setAgreementLoanLimit(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Residential Address</Label>
                <Input 
                  value={agreementAddress} 
                  onChange={e => setAgreementAddress(e.target.value)} 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              {/* Interest and Service Fee Config */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Loan Service Fee (%)</Label>
                  <Input 
                    type="number"
                    step="0.1"
                    value={agreementServiceFee} 
                    onChange={e => setAgreementServiceFee(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Interest Rate (%)</Label>
                  <Input 
                    type="number"
                    value={agreementInterest} 
                    onChange={e => setAgreementInterest(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                    disabled
                  />
                  <span className="text-[9px] font-bold text-slate-400">Interest is set to 0% as per Agreement Clause 4.2.</span>
                </div>
              </div>

              {/* SMS Verification (Signature Code) */}
              <div className="grid gap-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200/50">
                <Label className="font-black text-[10px] uppercase tracking-widest text-blue-600 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> SMS Verification Code (Electronic Signature)
                </Label>
                <Input 
                  value={agreementCode} 
                  onChange={e => setAgreementCode(e.target.value)} 
                  placeholder="Enter 6-digit signature code" 
                  className="h-10 border-blue-200 rounded-xl font-black text-center text-sm tracking-widest bg-white" 
                />
                <span className="text-[9px] font-semibold text-slate-500 leading-normal mt-0.5">
                  This code acts as the electronic signature of the Borrower under the Electronic Transactions Act No. 19 of 2006.
                </span>
              </div>

            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowAgreementModal(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button 
              onClick={handleGenerateAgreement} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-5 rounded-xl shadow-lg cursor-pointer"
            >
              Generate & Print PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer KYC Photos Viewer Dialog */}
      <Dialog 
        open={photoViewerClient.isOpen} 
        onOpenChange={(v) => setPhotoViewerClient(prev => ({ ...prev, isOpen: v }))}
      >
        <DialogContent className="w-[95vw] sm:w-[90vw] lg:max-w-3xl bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col overflow-hidden">
          <div className="h-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-primary shrink-0" />
          <div className="p-6 border-b border-slate-100">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 rounded-2xl text-emerald-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <DialogTitle className="text-xl sm:text-2xl font-black text-slate-900">
                    Customer KYC Scans
                  </DialogTitle>
                  <DialogDescription className="text-xs font-bold text-slate-500 mt-0.5">
                    {photoViewerClient.name} • <span className="font-mono text-primary font-black">NIC: {photoViewerClient.nic}</span>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {(!photoViewerClient.front && !photoViewerClient.back && !photoViewerClient.signature) ? (
              <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <CameraOff className="w-12 h-12 text-slate-300 mb-2" />
                <p className="text-sm font-bold text-slate-600">No Webcam KYC Photos Recorded</p>
                <p className="text-xs text-slate-400 mt-1">This customer does not have any saved NIC or signature scans yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* NIC Front */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-2">NIC Front</span>
                  <div className="w-full aspect-[4/3] bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                    {photoViewerClient.front ? (
                      <img 
                        src={photoViewerClient.front} 
                        alt="NIC Front" 
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${photoViewerClient.front}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">No Front Scan</span>
                    )}
                  </div>
                </div>

                {/* NIC Back */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-2">NIC Back</span>
                  <div className="w-full aspect-[4/3] bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                    {photoViewerClient.back ? (
                      <img 
                        src={photoViewerClient.back} 
                        alt="NIC Back" 
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${photoViewerClient.back}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">No Back Scan</span>
                    )}
                  </div>
                </div>

                {/* Signature */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-2">Customer Signature</span>
                  <div className="w-full aspect-[4/3] bg-white rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                    {photoViewerClient.signature ? (
                      <img 
                        src={photoViewerClient.signature} 
                        alt="Signature" 
                        className="w-full h-full object-contain cursor-zoom-in p-2"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${photoViewerClient.signature}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">No Signature Scan</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
            <Button 
              type="button" 
              onClick={() => setPhotoViewerClient(prev => ({ ...prev, isOpen: false }))}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 rounded-xl"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
