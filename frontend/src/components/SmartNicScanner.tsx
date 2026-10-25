'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Camera, 
  RotateCcw, 
  Upload, 
  Check, 
  ZoomIn, 
  Maximize2, 
  Minimize2, 
  FlipHorizontal, 
  AlertCircle,
  Image as ImageIcon,
  Zap,
  ZapOff,
  RefreshCcw
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { compressImage } from '@/lib/image-compression';

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
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMirrored, setIsMirrored] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(false);
  const [isCapturingFlash, setIsCapturingFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeDeviceIdRef = useRef<string | null>(null);
  const onCaptureRef = useRef(onCapture);

  // Keep refs updated
  useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  useEffect(() => {
    activeDeviceIdRef.current = activeDeviceId;
  }, [activeDeviceId]);

  // Sync initialImage prop
  useEffect(() => {
    const timer = setTimeout(() => {
      setCapturedImage(initialImage || null);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialImage]);

  // Shutter audio cue via Web Audio API
  const playShutterSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(950, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.08);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
      osc.start(now);
      osc.stop(now + 0.10);
    } catch {}
  }, []);

  // Stop camera stream cleanly
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setTorchOn(false);
  }, []);

  // Enumerate cameras
  const enumerateCameras = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all.filter(d => d.kind === 'videoinput');
      setDevices(videoInputs);

      if (videoInputs.length > 0 && !activeDeviceIdRef.current) {
        // Prefer rear camera on tablet / mobile for document & signature capture
        const backCam = videoInputs.find(d => 
          /back|rear|environment|main/i.test(d.label)
        );
        const chosenId = backCam ? backCam.deviceId : videoInputs[0].deviceId;
        setActiveDeviceId(chosenId);
        activeDeviceIdRef.current = chosenId;
        setIsMirrored(!backCam);
      }
    } catch (e) {
      console.warn('Camera enumeration notice:', e);
    }
  }, []);

  // Start camera stream
  const startCamera = useCallback(async (deviceIdOverride?: string) => {
    const targetId = deviceIdOverride || activeDeviceIdRef.current;
    try {
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
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: { ideal: 'environment' } } 
        });
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setError(null);

      // Check torch capability
      try {
        const track = mediaStream.getVideoTracks()[0];
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        setTorchAvailable(!!capabilities.torch);
      } catch {
        setTorchAvailable(false);
      }

      // Re-enumerate cameras in background to get real labels
      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(all => {
          const videoInputs = all.filter(d => d.kind === 'videoinput');
          setDevices(videoInputs);
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setError('Camera access denied or unavailable. You can upload an image from your gallery or files below.');
    }
  }, []);

  // Connect stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn('Video play notice:', e));
    }
  }, [stream]);

  // Initial lifecycle
  useEffect(() => {
    let mounted = true;
    const initCameras = async () => {
      await enumerateCameras();
      if (mounted && autoStart && !capturedImage) {
        await startCamera();
      }
    };
    initCameras();
    return () => {
      mounted = false;
      stopCamera();
    };
  }, []);

  // Manual Take Photo (Capture Current Frame)
  const handleTakePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    if (vw <= 0 || vh <= 0) return;

    // Trigger visual shutter flash & sound
    setIsCapturingFlash(true);
    playShutterSound();
    if (navigator.vibrate) {
      navigator.vibrate([40, 20]);
    }
    setTimeout(() => setIsCapturingFlash(false), 200);

    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (isMirrored) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, vw, vh);
      const rawBase64 = canvas.toDataURL('image/jpeg', 0.90);

      // Compress to optimal web KYC size
      const optimizedBase64 = await compressImage(rawBase64, 1400, 1050, 0.84);
      setCapturedImage(optimizedBase64);
      onCaptureRef.current(optimizedBase64);
      stopCamera();
    }
  };

  // Upload from Gallery / Files
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressImage(file, 1400, 1050, 0.84).then((compressedBase64) => {
        if (compressedBase64) {
          setCapturedImage(compressedBase64);
          onCaptureRef.current(compressedBase64);
          stopCamera();
        }
      });
      // Clear file input value so user can select the same file again if they retake
      e.target.value = '';
    }
  };

  // Retake Photo
  const handleRetake = () => {
    setCapturedImage(null);
    onCaptureRef.current(null);
    startCamera();
  };

  // Switch camera device (Rear / Front)
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

  return (
    <div className={`relative transition-all duration-300 ${
      isExpanded 
        ? 'fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md p-4 sm:p-6 flex flex-col justify-center items-center' 
        : 'w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl'
    }`}>
      {/* Hidden file input for gallery upload */}
      <input 
        ref={fileInputRef}
        type="file" 
        accept="image/*" 
        className="hidden" 
        onChange={handleFileUpload} 
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Header & Viewfinder Control Bar */}
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
                  Captured ✓
                </Badge>
              )}
            </h4>
          </div>
        </div>

        {/* Viewfinder Controls */}
        <div className="flex items-center gap-1.5">
          {stream && !capturedImage && (
            <>
              {/* Torch Button if supported */}
              {torchAvailable && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`p-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                    torchOn 
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                  title="Toggle Torch/Flashlight"
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
                  title="Switch camera device (Rear / Front)"
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
          : 'h-[220px] sm:h-[300px] md:h-[340px] max-h-[360px] border border-slate-800'
      }`}>
        {/* Shutter Flash Animation */}
        {isCapturingFlash && (
          <div className="absolute inset-0 bg-white z-40 animate-out fade-out duration-200" />
        )}

        {/* 1. Captured Photo Display */}
        {capturedImage ? (
          <div className="relative w-full h-full min-h-[180px] flex flex-col items-center justify-center bg-slate-950 p-2 group">
            <img 
              src={capturedImage} 
              alt={label} 
              className="max-w-full max-h-[180px] sm:max-h-[280px] object-contain rounded-xl shadow-lg cursor-pointer"
              onClick={() => setPreviewZoom(true)}
              title="Click to view full photo"
            />

            {/* Top View Full Button */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                onClick={() => setPreviewZoom(true)}
                className="bg-slate-900/90 hover:bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-md cursor-pointer backdrop-blur-md"
              >
                <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                <span>View Full</span>
              </button>
            </div>

            {/* Bottom Actions: Upload other & Retake */}
            <div className="absolute bottom-2 sm:bottom-3 inset-x-2 sm:inset-x-3 flex items-center justify-between pointer-events-auto gap-2">
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-900/90 hover:bg-slate-950 text-slate-200 text-[11px] sm:text-xs font-bold px-3 py-1.5 sm:py-2 rounded-xl border border-white/10 transition-all cursor-pointer flex items-center gap-1.5 backdrop-blur-md"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Gallery</span>
              </button>

              <button 
                type="button" 
                onClick={handleRetake}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black uppercase tracking-wider px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retake</span>
              </button>
            </div>
          </div>
        ) : stream ? (
          /* 2. Live Video Viewfinder with Manual Capture Button */
          <div className="relative w-full h-full min-h-[180px] flex items-center justify-center bg-black overflow-hidden">
            <video 
              ref={videoRef}
              autoPlay 
              playsInline 
              muted
              className={`w-full h-full object-contain transition-transform ${isMirrored ? 'scale-x-[-1]' : ''}`} 
            />

            {/* Subtle Alignment Guide Frame */}
            {!isSignature && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-4 sm:p-6 z-10">
                <div className="relative w-[90%] max-w-[440px] aspect-[1.586/1] rounded-2xl border-2 border-dashed border-white/30 transition-all">
                  <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 rounded-tl-xl border-amber-400" />
                  <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 rounded-tr-xl border-amber-400" />
                  <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 rounded-bl-xl border-amber-400" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 rounded-br-xl border-amber-400" />
                </div>
              </div>
            )}

            {/* Bottom Controls Bar: Gallery Upload & Manual "Take Photo" */}
            <div className="absolute bottom-2 sm:bottom-3 inset-x-2 sm:inset-x-3 flex items-center justify-between gap-1.5 sm:gap-2 pointer-events-auto z-20">
              {/* Gallery Upload Button */}
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-900/90 hover:bg-slate-950 text-slate-200 text-[11px] sm:text-xs font-bold px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 rounded-xl border border-white/10 flex items-center gap-1 shadow-md backdrop-blur-md cursor-pointer shrink-0"
              >
                <ImageIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" />
                <span>Gallery</span>
              </button>

              {/* Big Manual Take Photo Button (as requested by user) */}
              <button 
                type="button" 
                onClick={handleTakePhoto}
                className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-wider px-3.5 sm:px-6 py-1.5 sm:py-2.5 rounded-xl sm:rounded-2xl shadow-xl shadow-amber-500/25 flex items-center gap-1.5 sm:gap-2 cursor-pointer active:scale-95 transition-all border border-amber-300 shrink-0"
              >
                <Camera className="w-4 h-4 stroke-[2.5] shrink-0" />
                <span>Take Photo</span>
              </button>

              {/* Pause Camera */}
              <button 
                type="button" 
                onClick={stopCamera}
                className="bg-slate-900/90 hover:bg-slate-950 text-slate-400 hover:text-white text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1.5 sm:py-2.5 rounded-xl border border-white/10 shadow-md backdrop-blur-md cursor-pointer shrink-0"
              >
                Pause
              </button>
            </div>
          </div>
        ) : (
          /* 3. Camera Off / Standby State */
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
              Click Start Camera to take a photo or upload an image directly from your gallery.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                onClick={() => startCamera()}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider h-10 px-5 rounded-xl shadow-lg gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Start Camera</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="text-white border-white/20 hover:bg-white/10 text-xs font-bold h-10 px-4 rounded-xl gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload from Gallery</span>
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
              <span className="text-xs font-black uppercase tracking-wider text-slate-400">{label} • High Res Preview</span>
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
