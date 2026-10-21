'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Camera, 
  RefreshCcw, 
  Upload, 
  Check, 
  ZoomIn, 
  Maximize2, 
  Minimize2, 
  Sparkles, 
  Zap, 
  ZapOff, 
  FlipHorizontal, 
  Scan, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle,
  Eye
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface SmartNicScannerProps {
  onCapture: (base64: string | null) => void;
  label: string;
  initialImage?: string | null;
  autoStart?: boolean;
  isSignature?: boolean;
}

export function SmartNicScanner({
  onCapture,
  label,
  initialImage,
  autoStart = true,
  isSignature = false,
}: SmartNicScannerProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(initialImage || null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Controls & UX states
  const [previewZoom, setPreviewZoom] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [isMirrored, setIsMirrored] = useState(false);
  const [smartCropEnabled, setSmartCropEnabled] = useState(!isSignature);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isCapturingFlash, setIsCapturingFlash] = useState(false);

  // Edge detection & auto-capture states
  const [detectionStatus, setDetectionStatus] = useState<'searching' | 'aligning' | 'locked'>('searching');
  const [lockProgress, setLockProgress] = useState(0); // 0 to 100
  const [feedbackMsg, setFeedbackMsg] = useState('Position NIC inside the guide frame');

  // DOM & State Refs (Crucial for stability without re-render thrashing or shaking loops)
  const streamRef = useRef<MediaStream | null>(null);
  const activeDeviceIdRef = useRef<string | null>(null);
  const isMirroredRef = useRef<boolean>(false);
  const smartCropRef = useRef<boolean>(!isSignature);
  const autoCaptureEnabledRef = useRef<boolean>(true);
  const isSignatureRef = useRef<boolean>(isSignature);
  const onCaptureRef = useRef(onCapture);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  const animFrameRef = useRef<number | null>(null);
  const lockCounterRef = useRef<number>(0);
  const isAutoCapturingRef = useRef<boolean>(false);
  const detectionStatusRef = useRef<'searching' | 'aligning' | 'locked'>('searching');
  const lockProgressRef = useRef<number>(0);

  // Keep refs in sync with state/props
  useEffect(() => { activeDeviceIdRef.current = activeDeviceId; }, [activeDeviceId]);
  useEffect(() => { isMirroredRef.current = isMirrored; }, [isMirrored]);
  useEffect(() => { smartCropRef.current = smartCropEnabled; }, [smartCropEnabled]);
  useEffect(() => { autoCaptureEnabledRef.current = autoCaptureEnabled; }, [autoCaptureEnabled]);
  useEffect(() => { isSignatureRef.current = isSignature; }, [isSignature]);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  // Audio cues via Web Audio API
  const playAudioCue = useCallback((type: 'lock' | 'snap') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'lock') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.10, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'snap') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1000, now);
        osc.frequency.exponentialRampToValueAtTime(350, now + 0.09);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      }
    } catch {}
  }, []);

  // Sync initialImage prop
  useEffect(() => {
    setCapturedImage(initialImage || null);
  }, [initialImage]);

  // Stop camera cleanly (STABLE - NO LOOP DEPENDENCIES)
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  // Enumerate video devices (STABLE)
  const enumerateCameras = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all.filter(d => d.kind === 'videoinput');
      setDevices(videoInputs);

      if (videoInputs.length > 0 && !activeDeviceIdRef.current) {
        // Prefer rear camera on mobile/tablet for document scanning
        const backCam = videoInputs.find(d => 
          /back|rear|environment|main/i.test(d.label)
        );
        const chosenId = backCam ? backCam.deviceId : videoInputs[0].deviceId;
        setActiveDeviceId(chosenId);
        activeDeviceIdRef.current = chosenId;
      }
    } catch (e) {
      console.warn('Camera enumeration notice:', e);
    }
  }, []);

  // Start the video stream cleanly (STABLE - NO STREAM DEPENDENCY)
  const startCamera = useCallback(async (deviceIdOverride?: string) => {
    const targetId = deviceIdOverride || activeDeviceIdRef.current;
    try {
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
      };

      if (targetId) {
        videoConstraints.deviceId = { exact: targetId };
      } else {
        videoConstraints.facingMode = { ideal: 'environment' };
      }

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      } catch {
        // Fallback to basic constraint
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: { ideal: 'environment' } } 
        });
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setError(null);
      isAutoCapturingRef.current = false;
      lockCounterRef.current = 0;
      lockProgressRef.current = 0;
      setLockProgress(0);

      // Check torch capability
      try {
        const track = mediaStream.getVideoTracks()[0];
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        setTorchAvailable(!!capabilities.torch);
      } catch {
        setTorchAvailable(false);
      }

      // Re-enumerate cameras in background without blocking
      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(all => {
          const videoInputs = all.filter(d => d.kind === 'videoinput');
          setDevices(videoInputs);
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setError('Camera access denied or unavailable. You can upload an image file using the button below.');
    }
  }, []);

  // Connect stream to video element when stream or videoRef attaches
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn('Video play notice:', e));
    }
  }, [stream]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    try {
      const track = streamRef.current.getVideoTracks()[0];
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }]
      });
      setTorchOn(nextState);
    } catch (e) {
      console.warn('Torch toggle failed:', e);
    }
  };

  // Switch camera device
  const switchCamera = () => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex(d => d.deviceId === activeDeviceIdRef.current);
    const nextIndex = (currentIndex + 1) % devices.length;
    const nextDevice = devices[nextIndex];
    setActiveDeviceId(nextDevice.deviceId);
    activeDeviceIdRef.current = nextDevice.deviceId;

    const isFront = /front|selfie|user/i.test(nextDevice.label);
    setIsMirrored(isFront);
    startCamera(nextDevice.deviceId);
  };

  // Capture the photo from current video frame
  const capturePhoto = useCallback((autoTriggered = false) => {
    if (isAutoCapturingRef.current && autoTriggered) return;
    isAutoCapturingRef.current = true;

    // Immediately stop detection loop during capture
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      isAutoCapturingRef.current = false;
      return;
    }

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    if (vw <= 0 || vh <= 0) {
      isAutoCapturingRef.current = false;
      return;
    }

    // Trigger visual shutter flash
    setIsCapturingFlash(true);
    playAudioCue('snap');
    if (navigator.vibrate) {
      navigator.vibrate([40, 30, 80]);
    }
    setTimeout(() => setIsCapturingFlash(false), 240);

    const mirrored = isMirroredRef.current;
    const shouldCrop = smartCropRef.current && !isSignatureRef.current;

    if (shouldCrop) {
      // Guide coordinates on the video frame (aspect ratio 1.586 : 1)
      const targetRatio = 1.586;
      let cropW = vw * 0.82;
      let cropH = cropW / targetRatio;
      if (cropH > vh * 0.88) {
        cropH = vh * 0.88;
        cropW = cropH * targetRatio;
      }
      const cropX = Math.max(0, (vw - cropW) / 2);
      const cropY = Math.max(0, (vh - cropH) / 2);

      canvas.width = Math.round(cropW);
      canvas.height = Math.round(cropH);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (mirrored) {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.92);
        setCapturedImage(base64);
        onCaptureRef.current(base64);
        stopCamera();
      }
    } else {
      // Full frame capture
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (mirrored) {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, vw, vh);
        const base64 = canvas.toDataURL('image/jpeg', 0.90);
        setCapturedImage(base64);
        onCaptureRef.current(base64);
        stopCamera();
      }
    }

    isAutoCapturingRef.current = false;
  }, [playAudioCue, stopCamera]);

  // Real-time Computer Vision Edge & Document Alignment Detection Loop
  useEffect(() => {
    if (!stream || !autoCaptureEnabled || capturedImage) {
      return;
    }

    let isRunning = true;
    let lastProcessTime = 0;

    const processFrame = (currentTime: number) => {
      if (!isRunning || isAutoCapturingRef.current) return;

      // Throttle detection to ~16-18 fps to prevent tablet CPU overload & battery drain
      if (currentTime - lastProcessTime > 65) {
        lastProcessTime = currentTime;
        analyzeCardEdges();
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    const updateDetectionUI = (
      newStatus: 'searching' | 'aligning' | 'locked', 
      newMsg: string, 
      newProgress: number
    ) => {
      if (detectionStatusRef.current !== newStatus) {
        detectionStatusRef.current = newStatus;
        setDetectionStatus(newStatus);
        setFeedbackMsg(newMsg);
      }
      if (Math.abs(lockProgressRef.current - newProgress) >= 8 || newProgress === 0 || newProgress === 100) {
        lockProgressRef.current = newProgress;
        setLockProgress(newProgress);
      }
    };

    const analyzeCardEdges = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      // Downscaled offscreen canvas for zero-lag edge calculation
      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
      }
      const oc = offscreenCanvasRef.current;
      const sw = 260;
      const sh = 164;
      if (oc.width !== sw || oc.height !== sh) {
        oc.width = sw;
        oc.height = sh;
      }
      const octx = oc.getContext('2d', { willReadFrequently: true });
      if (!octx) return;

      octx.drawImage(video, 0, 0, sw, sh);
      let imgData: ImageData;
      try {
        imgData = octx.getImageData(0, 0, sw, sh);
      } catch {
        return;
      }

      const data = imgData.data;

      // Target card guide frame in downscaled coords (aspect ratio 1.586)
      const boxW = Math.round(sw * 0.76);
      const boxH = Math.round(boxW / 1.586);
      const boxX = Math.round((sw - boxW) / 2);
      const boxY = Math.round((sh - boxH) / 2);

      // Measure edge gradients along the 4 borders
      let topEdgeContrast = 0;
      let bottomEdgeContrast = 0;
      let leftEdgeContrast = 0;
      let rightEdgeContrast = 0;
      const sampleStep = 5;

      // Horizontal borders (Top and Bottom)
      for (let x = boxX; x < boxX + boxW; x += sampleStep) {
        const idxTopInner = ((boxY + 3) * sw + x) * 4;
        const idxTopOuter = (Math.max(0, boxY - 5) * sw + x) * 4;
        const lumTopInner = data[idxTopInner] * 0.299 + data[idxTopInner + 1] * 0.587 + data[idxTopInner + 2] * 0.114;
        const lumTopOuter = data[idxTopOuter] * 0.299 + data[idxTopOuter + 1] * 0.587 + data[idxTopOuter + 2] * 0.114;
        topEdgeContrast += Math.abs(lumTopInner - lumTopOuter);

        const idxBotInner = ((boxY + boxH - 3) * sw + x) * 4;
        const idxBotOuter = (Math.min(sh - 1, boxY + boxH + 5) * sw + x) * 4;
        const lumBotInner = data[idxBotInner] * 0.299 + data[idxBotInner + 1] * 0.587 + data[idxBotInner + 2] * 0.114;
        const lumBotOuter = data[idxBotOuter] * 0.299 + data[idxBotOuter + 1] * 0.587 + data[idxBotOuter + 2] * 0.114;
        bottomEdgeContrast += Math.abs(lumBotInner - lumBotOuter);
      }

      // Vertical borders (Left and Right)
      for (let y = boxY; y < boxY + boxH; y += sampleStep) {
        const idxLeftInner = (y * sw + (boxX + 3)) * 4;
        const idxLeftOuter = (y * sw + Math.max(0, boxX - 5)) * 4;
        const lumLeftInner = data[idxLeftInner] * 0.299 + data[idxLeftInner + 1] * 0.587 + data[idxLeftInner + 2] * 0.114;
        const lumLeftOuter = data[idxLeftOuter] * 0.299 + data[idxLeftOuter + 1] * 0.587 + data[idxLeftOuter + 2] * 0.114;
        leftEdgeContrast += Math.abs(lumLeftInner - lumLeftOuter);

        const idxRightInner = (y * sw + (boxX + boxW - 3)) * 4;
        const idxRightOuter = (y * sw + Math.min(sw - 1, boxX + boxW + 5)) * 4;
        const lumRightInner = data[idxRightInner] * 0.299 + data[idxRightInner + 1] * 0.587 + data[idxRightInner + 2] * 0.114;
        const lumRightOuter = data[idxRightOuter] * 0.299 + data[idxRightOuter + 1] * 0.587 + data[idxRightOuter + 2] * 0.114;
        rightEdgeContrast += Math.abs(lumRightInner - lumRightOuter);
      }

      const hSamples = (boxW / sampleStep) || 1;
      const vSamples = (boxH / sampleStep) || 1;

      const avgTop = topEdgeContrast / hSamples;
      const avgBot = bottomEdgeContrast / hSamples;
      const avgLeft = leftEdgeContrast / vSamples;
      const avgRight = rightEdgeContrast / vSamples;

      // Sharpness check inside the card (Laplacian variance approximation)
      let sharpnessSum = 0;
      let centerSamples = 0;
      for (let y = boxY + 14; y < boxY + boxH - 14; y += 8) {
        for (let x = boxX + 14; x < boxX + boxW - 14; x += 8) {
          const idx = (y * sw + x) * 4;
          const idxRight = (y * sw + x + 1) * 4;
          const idxDown = ((y + 1) * sw + x) * 4;
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
          const lumR = data[idxRight] * 0.299 + data[idxRight + 1] * 0.587 + data[idxRight + 2] * 0.114;
          const lumD = data[idxDown] * 0.299 + data[idxDown + 1] * 0.587 + data[idxDown + 2] * 0.114;
          sharpnessSum += Math.abs(lum - lumR) + Math.abs(lum - lumD);
          centerSamples++;
        }
      }
      const avgSharpness = centerSamples > 0 ? (sharpnessSum / centerSamples) : 0;

      // Detection threshold: cards have clear border contrast against tables
      const borderEdgesDetected = (avgTop > 12 ? 1 : 0) + 
                                  (avgBot > 12 ? 1 : 0) + 
                                  (avgLeft > 12 ? 1 : 0) + 
                                  (avgRight > 12 ? 1 : 0);

      const isSharp = avgSharpness > 5.0;

      if (borderEdgesDetected >= 3 && isSharp) {
        // High confidence card match!
        lockCounterRef.current += 1;
        const currentProg = Math.min(100, Math.round((lockCounterRef.current / 12) * 100));

        updateDetectionUI('locked', 'NIC Detected! Hold steady...', currentProg);

        if (lockCounterRef.current === 1) {
          playAudioCue('lock');
        }

        // Trigger auto-snap after holding steady for ~750ms (approx 12 checks)
        if (lockCounterRef.current >= 12 && !isAutoCapturingRef.current) {
          capturePhoto(true);
        }
      } else if (borderEdgesDetected >= 2 || avgSharpness > 8.0) {
        // Aligning
        lockCounterRef.current = Math.max(0, lockCounterRef.current - 1);
        const currentProg = Math.min(100, Math.round((lockCounterRef.current / 12) * 100));
        updateDetectionUI('aligning', 'Aligning NIC edges with guide frame...', currentProg);
      } else {
        // Searching
        lockCounterRef.current = 0;
        updateDetectionUI('searching', 'Place NIC card flat inside the frame', 0);
      }
    };

    animFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [stream, autoCaptureEnabled, capturedImage, capturePhoto, playAudioCue]);

  // Initial lifecycle: start once on mount if autoStart is true
  useEffect(() => {
    enumerateCameras();
    if (autoStart && !capturedImage) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, []); // Run ONCE on mount!

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

  const handleRetake = () => {
    setCapturedImage(null);
    onCapture(null);
    startCamera();
  };

  return (
    <div className={`relative transition-all duration-300 ${
      isExpanded 
        ? 'fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md p-4 sm:p-6 flex flex-col justify-center items-center' 
        : 'w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl'
    }`}>
      {/* Hidden file input & capture canvases */}
      <input 
        ref={fileInputRef}
        type="file" 
        accept="image/*" 
        className="hidden" 
        onChange={handleFileUpload} 
      />
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* Top Header & Quick Action Bar */}
      <div className="w-full flex items-center justify-between gap-2 mb-2 sm:mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
              <span>{label}</span>
              {capturedImage && (
                <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold px-1.5 py-0">
                  Ready ✓
                </Badge>
              )}
            </h4>
          </div>
        </div>

        {/* Viewfinder Controls */}
        <div className="flex items-center gap-1.5">
          {stream && !capturedImage && (
            <>
              {/* Auto Capture Toggle */}
              <button
                type="button"
                onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                  autoCaptureEnabled 
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-sm' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Toggle real-time AI card edge auto-capture"
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span className="hidden sm:inline">Auto-Edge:</span>
                <span>{autoCaptureEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {/* Torch Button if available */}
              {torchAvailable && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`p-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                    torchOn 
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                  title="Toggle Torch/Flash"
                >
                  {torchOn ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
                </button>
              )}

              {/* Mirror toggle */}
              <button
                type="button"
                onClick={() => setIsMirrored(!isMirrored)}
                className={`p-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                  isMirrored 
                    ? 'bg-primary/20 text-primary border-primary/30' 
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
                title="Mirror horizontal flip"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
              </button>

              {/* Switch Camera */}
              {devices.length > 1 && (
                <button
                  type="button"
                  onClick={switchCamera}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  title="Switch camera device"
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          {/* Fullscreen / Expand Viewfinder button for Tablet & Mobile */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              isExpanded 
                ? 'bg-amber-500 text-slate-900 border-amber-400 font-bold' 
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={isExpanded ? 'Minimize Viewfinder' : 'Expand full tablet viewfinder'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Scanner Viewport Area */}
      <div className={`relative w-full rounded-2xl overflow-hidden bg-black flex items-center justify-center transition-all ${
        isExpanded 
          ? 'h-[75vh] max-w-4xl border-2 border-amber-500/40 shadow-2xl' 
          : 'min-h-[320px] sm:min-h-[380px] md:min-h-[440px] max-h-[520px] border border-slate-800'
      }`}>
        {/* Shutter Flash Animation */}
        {isCapturingFlash && (
          <div className="absolute inset-0 bg-white z-40 animate-out fade-out duration-300" />
        )}

        {/* 1. Captured Image Display */}
        {capturedImage ? (
          <div className="relative w-full h-full min-h-[320px] flex items-center justify-center bg-slate-950 p-2 group">
            <img 
              src={capturedImage} 
              alt={label} 
              className="max-w-full max-h-[480px] object-contain rounded-xl shadow-lg cursor-pointer"
              onClick={() => setPreviewZoom(true)}
              title="Click to zoom image"
            />
            <div className="absolute top-3 left-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewZoom(true)}
                className="bg-slate-900/90 hover:bg-slate-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-md cursor-pointer backdrop-blur-md"
              >
                <ZoomIn className="w-3.5 h-3.5 text-amber-400" /> View Full
              </button>
            </div>
            
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-900/90 text-slate-200 text-xs font-bold px-3.5 py-2 rounded-xl border border-white/10 hover:bg-slate-950 transition-all cursor-pointer flex items-center gap-1.5 backdrop-blur-md"
              >
                <Upload className="w-3.5 h-3.5" /> File
              </button>
              <button 
                type="button" 
                onClick={handleRetake}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black uppercase tracking-wider px-4 py-2 rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Retake
              </button>
            </div>
          </div>
        ) : stream ? (
          /* 2. Live Video Viewfinder with Real-Time HUD */
          <div className="relative w-full h-full min-h-[320px] flex items-center justify-center bg-black overflow-hidden">
            <video 
              ref={videoRef}
              autoPlay 
              playsInline 
              muted
              className={`w-full h-full object-cover transition-transform ${isMirrored ? 'scale-x-[-1]' : ''}`} 
            />

            {/* Smart NIC Alignment Guide Frame (ID Card Aspect Ratio: ~1.586) */}
            {!isSignature && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
                {/* ID Card Target Frame */}
                <div className={`relative w-[86%] max-w-[460px] aspect-[1.586/1] rounded-2xl transition-all duration-300 ${
                  detectionStatus === 'locked' 
                    ? 'border-2 border-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.45)]' 
                    : detectionStatus === 'aligning'
                    ? 'border-2 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.3)]'
                    : 'border-2 border-white/30'
                }`}>
                  {/* High-Tech Animated Corner Reticles */}
                  {/* Top-Left */}
                  <div className={`absolute -top-1.5 -left-1.5 w-6 h-6 border-t-4 border-l-4 rounded-tl-xl transition-colors duration-200 ${
                    detectionStatus === 'locked' ? 'border-emerald-400' : detectionStatus === 'aligning' ? 'border-amber-400' : 'border-amber-400/80'
                  }`} />
                  {/* Top-Right */}
                  <div className={`absolute -top-1.5 -right-1.5 w-6 h-6 border-t-4 border-r-4 rounded-tr-xl transition-colors duration-200 ${
                    detectionStatus === 'locked' ? 'border-emerald-400' : detectionStatus === 'aligning' ? 'border-amber-400' : 'border-amber-400/80'
                  }`} />
                  {/* Bottom-Left */}
                  <div className={`absolute -bottom-1.5 -left-1.5 w-6 h-6 border-b-4 border-l-4 rounded-bl-xl transition-colors duration-200 ${
                    detectionStatus === 'locked' ? 'border-emerald-400' : detectionStatus === 'aligning' ? 'border-amber-400' : 'border-amber-400/80'
                  }`} />
                  {/* Bottom-Right */}
                  <div className={`absolute -bottom-1.5 -right-1.5 w-6 h-6 border-b-4 border-r-4 rounded-br-xl transition-colors duration-200 ${
                    detectionStatus === 'locked' ? 'border-emerald-400' : detectionStatus === 'aligning' ? 'border-amber-400' : 'border-amber-400/80'
                  }`} />

                  {/* Laser Scanning Beam (when searching) */}
                  {detectionStatus === 'searching' && autoCaptureEnabled && (
                    <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_10px_#f59e0b] animate-bounce duration-1000 top-1/2 -translate-y-1/2" />
                  )}

                  {/* Watermark Guide Graphic */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 select-none">
                    <Scan className="w-12 h-12 text-white stroke-[1.5] mb-1" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Sri Lankan NIC (ID-1)</span>
                  </div>

                  {/* Lock Countdown Progress Ring / Indicator */}
                  {detectionStatus === 'locked' && autoCaptureEnabled && (
                    <div className="absolute inset-0 flex items-center justify-center bg-emerald-950/20 rounded-2xl backdrop-blur-[1px]">
                      <div className="bg-slate-950/90 border border-emerald-400/80 px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-2.5 animate-pulse">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 stroke-[2.5]" />
                        <div>
                          <span className="text-xs font-black text-emerald-300 uppercase tracking-wider block">
                            Capturing ({lockProgress}%)
                          </span>
                          <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                            <div 
                              className="h-full bg-emerald-400 transition-all duration-75"
                              style={{ width: `${lockProgress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Real-time Status Badge Banner */}
                <div className="mt-3">
                  <div className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 backdrop-blur-md border shadow-lg transition-all ${
                    detectionStatus === 'locked'
                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
                      : detectionStatus === 'aligning'
                      ? 'bg-amber-950/90 text-amber-300 border-amber-500/50'
                      : 'bg-slate-900/85 text-slate-200 border-white/20'
                  }`}>
                    {detectionStatus === 'locked' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin duration-1000" />
                    )}
                    <span>{feedbackMsg}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Floating Control Bar */}
            <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2 pointer-events-auto">
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-900/90 hover:bg-slate-950 text-slate-300 text-[11px] font-bold px-3 py-2 rounded-xl border border-white/10 flex items-center gap-1.5 shadow-md backdrop-blur-md cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Upload</span> File
              </button>

              {/* Big Manual Snap Button */}
              <button 
                type="button" 
                onClick={() => capturePhoto(false)}
                className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-wider px-5 py-2.5 rounded-2xl shadow-xl shadow-amber-500/20 flex items-center gap-2 cursor-pointer active:scale-95 transition-all border border-amber-300"
              >
                <Camera className="w-4 h-4 stroke-[2.5]" />
                <span>Snap Photo</span>
              </button>

              <button 
                type="button" 
                onClick={stopCamera}
                className="bg-slate-900/90 hover:bg-slate-950 text-slate-400 hover:text-white text-[11px] font-bold px-3 py-2 rounded-xl border border-white/10 shadow-md backdrop-blur-md cursor-pointer"
              >
                Pause
              </button>
            </div>
          </div>
        ) : (
          /* 3. Camera Off / Error State with Friendly Start Button */
          <div className="p-6 text-center flex flex-col items-center justify-center space-y-3">
            {error ? (
              <div className="max-w-md bg-red-500/10 border border-red-500/30 p-3 rounded-xl text-red-300 text-xs font-medium flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 mb-1">
                <Camera className="w-7 h-7" />
              </div>
            )}

            <p className="text-xs text-slate-400 font-bold max-w-sm">
              Camera is currently inactive. Click Start Webcam to begin edge auto-capture or upload a file.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                onClick={() => startCamera()}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider h-10 px-5 rounded-xl shadow-lg gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Start Webcam</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="text-white border-white/20 hover:bg-white/10 text-xs font-bold h-10 px-4 rounded-xl gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload File</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Photo Zoom Modal */}
      {previewZoom && capturedImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setPreviewZoom(false)}
        >
          <div className="relative max-w-4xl max-h-[85vh] p-2 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <img 
              src={capturedImage} 
              alt="Zoomed scan" 
              className="max-w-full max-h-[75vh] object-contain rounded-xl"
            />
            <div className="w-full flex items-center justify-between pt-3 px-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-400">{label} • High Res</span>
              <Button 
                type="button"
                size="sm"
                onClick={() => setPreviewZoom(false)}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl"
              >
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
