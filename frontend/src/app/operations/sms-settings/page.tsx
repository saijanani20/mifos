'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Smartphone, Send, RefreshCcw, Save,
  CheckCircle2, AlertTriangle, MessageSquare, Radio, Server,
  Building2, Lock, Activity, BatteryCharging, Battery, Wifi,
  RotateCcw, Users, Sliders, FileText, Trash2, Search, CheckSquare, Square,
  ChevronDown, ChevronRight, Power, Gauge, Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { normalizeBranchId } from '@/lib/branch-mapping';
import {
  buildInterestPaymentSms,
  buildPawnApprovedSms,
  buildPawnReceiptSms,
  buildPawnRedeemSms,
  buildPawnReminderSms,
  buildForfeitureWarningSms,
  buildPawnReturnedSms,
  calculateSmsParts,
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_SMS_TRIGGERS,
  getSriLankaDateString,
  normalizeSriLankaPhone,
  SMS_TEMPLATE_LABELS,
  SMS_TRIGGER_META,
  SmsTemplateKey,
  SmsTriggersConfig,
} from '@/lib/sms-templates';
import type {
  TextBeeDiscoveredDevice,
  TextBeeHealthStatus,
  TextBeeQuotaStatus,
  FormattedSmsLogRow,
} from '@/lib/sms';

type TabKey = 'gateway' | 'dispatch' | 'templates' | 'logs';

interface BranchRow {
  id: string;
  name?: string;
}

interface BranchSanitizedConfig {
  branchId?: string;
  branchName?: string;
  email?: string;
  deviceId?: string;
  hasApiKey?: boolean;
  maskedApiKey?: string;
  simSlot?: number;
  enabled?: boolean;
  updatedAt?: string | null;
}

interface GatewayConfigDto {
  enabled?: boolean;
  email?: string;
  deviceId?: string;
  hasApiKey?: boolean;
  maskedApiKey?: string;
  simSlot?: number;
  branches?: Record<string, BranchSanitizedConfig>;
  configuredBranchCount?: number;
  triggers?: SmsTriggersConfig;
  templates?: Partial<Record<SmsTemplateKey, string>>;
}

interface PawnRecipientRow {
  id: string;
  bill_no?: string;
  display_bill_no?: string;
  branch_id?: string;
  phone?: string;
  client_phone?: string;
  client_name?: string;
  customer_name?: string;
  disbursed_amount?: number;
  clients?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
  };
}

interface BulkDispatchSummary {
  total: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
  invalidCount: number;
}

function getErrText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatResetDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Colombo',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function SmsSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('gateway');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isHead, setIsHead] = useState(false);
  const [userBranchId, setUserBranchId] = useState('HQ');

  /* Branch & Config State */
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('GLOBAL');
  const [globalConfig, setGlobalConfig] = useState<GatewayConfigDto>({});
  const [branchConfigs, setBranchConfigs] = useState<Record<string, BranchSanitizedConfig>>({});
  const [showBranchOverrides, setShowBranchOverrides] = useState(false);

  /* Gateway Form Fields (NO hardcoded API secrets) */
  const [deviceId, setDeviceId] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savedMaskedKey, setSavedMaskedKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [simSlot, setSimSlot] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [discoveredDevices, setDiscoveredDevices] = useState<TextBeeDiscoveredDevice[]>([]);

  /* Live Device Health & TextBee Quota */
  const [health, setHealth] = useState<TextBeeHealthStatus | null>(null);
  const [quota, setQuota] = useState<TextBeeQuotaStatus | null>(null);

  /* Test SMS State */
  const [testBranchId, setTestBranchId] = useState<string>('GLOBAL');
  const [testTemplateKey, setTestTemplateKey] = useState<SmsTemplateKey>('RECEIPT');
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState(() =>
    buildPawnReceiptSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000 })
  );

  /* Triggers & Templates State */
  const [triggers, setTriggers] = useState<SmsTriggersConfig>({ ...DEFAULT_SMS_TRIGGERS });
  const [templates, setTemplates] = useState<Record<SmsTemplateKey, string>>({ ...DEFAULT_SMS_TEMPLATES });
  const [activeTemplateKey, setActiveTemplateKey] = useState<SmsTemplateKey>('RECEIPT');

  /* Logs & Filters State */
  const [logs, setLogs] = useState<FormattedSmsLogRow[]>([]);
  const [stats, setStats] = useState({ total: 0, sent: 0, queued: 0, failed: 0, todaySent: 0, retryable7d: 0 });
  const [logStatusFilter, setLogStatusFilter] = useState<string>('ALL');
  const [logBranchFilter, setLogBranchFilter] = useState<string>('ALL');
  const [logSearch, setLogSearch] = useState<string>('');

  /* Bulk Reminders State */
  const [bulkBranch, setBulkBranch] = useState<string>('ALL');
  const [bulkSearch, setBulkSearch] = useState<string>('');
  const [bulkPawns, setBulkPawns] = useState<PawnRecipientRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectedPawnIds, setSelectedPawnIds] = useState<Set<string>>(new Set());
  const [bulkTemplateKey, setBulkTemplateKey] = useState<SmsTemplateKey>('REMINDER');
  const [bulkCustomMsg, setBulkCustomMsg] = useState<string>(DEFAULT_SMS_TEMPLATES.REMINDER);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<BulkDispatchSummary | null>(null);

  const populateFields = useCallback((branchId: string, cfg: GatewayConfigDto) => {
    const bConfigs = cfg?.branches || {};
    if (branchId === 'GLOBAL') {
      setDeviceId(cfg?.deviceId || '');
      setApiKeyInput('');
      setClearApiKey(false);
      setHasSavedKey(Boolean(cfg?.hasApiKey));
      setSavedMaskedKey(cfg?.maskedApiKey || '');
      setSimSlot(String(cfg?.simSlot ?? 0));
      setEnabled(cfg?.enabled !== false);
    } else {
      const norm = normalizeBranchId(branchId);
      const bConf = bConfigs[norm] || bConfigs[branchId] || {};
      setDeviceId(bConf.deviceId || '');
      setApiKeyInput('');
      setClearApiKey(false);
      setHasSavedKey(Boolean(bConf.hasApiKey));
      setSavedMaskedKey(bConf.maskedApiKey || '');
      setSimSlot(String(bConf.simSlot ?? 0));
      setEnabled(bConf.enabled !== false);
    }
  }, []);

  const fetchLiveHealth = useCallback(async (targetBranch: string, silent = true) => {
    setHealthLoading(true);
    try {
      const res = await fetch(
        `/api/notifications/sms?action=health&branchId=${encodeURIComponent(targetBranch)}`,
        { headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Health check failed');
      setHealth(data.health || null);
      if (data.health?.quota || data.quota) {
        setQuota(data.health?.quota || data.quota);
      }
      if (!silent) {
        if (data.health?.online) {
          toast.success(`Device Online (${data.health.model || 'TextBee Android'})`, {
            description: `Battery ${data.health.batteryPercentage ?? '?'}% • Last ping ${data.health.heartbeatAgeMinutes ?? 0}m ago`
          });
        } else {
          toast.warning(`Gateway Status: ${data.health?.status || 'UNKNOWN'}`, {
            description: data.health?.error || 'Device heartbeat may be delayed.'
          });
        }
      }
    } catch (err: unknown) {
      if (!silent) toast.error(getErrText(err, 'Health probe failed'));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadSettingsAndLogs = useCallback(async (opts?: { branch?: string; status?: string; search?: string; skipHealth?: boolean }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const b = opts?.branch ?? logBranchFilter;
      const st = opts?.status ?? logStatusFilter;
      const q = opts?.search ?? logSearch;
      if (b && b !== 'ALL') params.set('branch', b);
      if (st && st !== 'ALL') params.set('status', st);
      if (q && q.trim()) params.set('search', q.trim());

      const res = await fetch(`/api/notifications/sms?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load SMS gateway status');
      const data = await res.json();

      const adminFlag = Boolean(data.isAdmin);
      const headFlag = Boolean(data.isHead);
      const uBranch = String(data.userBranchId || 'HQ');

      setIsAdmin(adminFlag);
      setIsHead(headFlag);
      setUserBranchId(uBranch);
      setBranches(
        ((data.branches || [{ id: 'HQ', name: 'Head Office' }]) as BranchRow[])
          .filter((br) => String(br.id).toUpperCase() !== 'TESTBRANCH')
      );
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      if (data.stats) setStats(data.stats);

      const cfg: GatewayConfigDto = data.config || {};
      setGlobalConfig(cfg);
      setBranchConfigs(cfg.branches || {});

      if (cfg.triggers) {
        setTriggers({ ...DEFAULT_SMS_TRIGGERS, ...cfg.triggers });
      }
      const mergedTemplates = { ...DEFAULT_SMS_TEMPLATES };
      if (cfg.templates) {
        for (const k of Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplateKey[]) {
          if (cfg.templates[k]) mergedTemplates[k] = cfg.templates[k] as string;
        }
      }
      setTemplates(mergedTemplates);

      const targetBranch = !adminFlag && !headFlag && uBranch ? uBranch : selectedBranchId;
      if (!adminFlag && !headFlag && uBranch) {
        setSelectedBranchId(uBranch);
        setTestBranchId(uBranch);
        setBulkBranch(uBranch);
      }
      populateFields(targetBranch, cfg);

      if (!opts?.skipHealth) {
        fetchLiveHealth(targetBranch, true);
      }
    } catch (e: unknown) {
      console.error(e);
      toast.error(getErrText(e, 'Failed to load SMS settings'));
    } finally {
      setLoading(false);
    }
  }, [fetchLiveHealth, logBranchFilter, logSearch, logStatusFilter, populateFields, selectedBranchId]);

  useEffect(() => {
    loadSettingsAndLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBranchSelect = (newBranchId: string) => {
    setSelectedBranchId(newBranchId);
    setTestBranchId(newBranchId);
    setDiscoveredDevices([]);
    populateFields(newBranchId, { ...globalConfig, branches: branchConfigs });
    fetchLiveHealth(newBranchId, true);
  };

  const handleDiscoverDevices = async () => {
    if (!isAdmin) return;
    if (!apiKeyInput.trim() && !hasSavedKey) {
      return toast.error('Paste your TextBee API Key first, then click Detect Device.');
    }
    setDiscovering(true);
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'DISCOVER_DEVICES',
          branchId: selectedBranchId === 'GLOBAL' ? 'GLOBAL' : selectedBranchId,
          apiKey: apiKeyInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not detect TextBee devices');
      const list = Array.isArray(data.devices) ? (data.devices as TextBeeDiscoveredDevice[]) : [];
      setDiscoveredDevices(list);
      if (data.quota) setQuota(data.quota);

      if (list.length === 0) {
        toast.warning('No Android devices registered in this TextBee account yet.', {
          description: 'Open TextBee app on your Android phone/tablet and link it first.',
        });
      } else {
        const preferred = list.find((d) => d.isDefault) || list[0];
        setDeviceId(preferred.id);
        toast.success(`Found ${list.length} device(s) — selected ${preferred.name}`, {
          description: 'Click "Save & Connect" below to activate.',
        });
      }
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Device detection failed'));
    } finally {
      setDiscovering(false);
    }
  };

  const handleToggleGateway = async () => {
    if (!isAdmin) return toast.error('Only Administrators can pause/enable SMS Gateway.');
    const nextEnabled = !(globalConfig.enabled !== false);
    setSaving(true);
    const toastId = toast.loading(nextEnabled ? 'Enabling TextBee SMS Gateway...' : 'Pausing SMS Gateway...');
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'TOGGLE_ENABLED',
          branchId: 'GLOBAL',
          enabled: nextEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Toggle failed');
      toast.success(nextEnabled ? 'SMS Gateway ENABLED' : 'SMS Gateway PAUSED', { id: toastId });
      await loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Failed to toggle gateway'), { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!isAdmin) return toast.error('Only Administrators can modify SMS Gateway settings.');
    if (!deviceId.trim()) return toast.error('Enter or detect a TextBee Device ID before saving.');
    if (!apiKeyInput.trim() && !hasSavedKey) return toast.error('Enter your TextBee API Key.');

    setSaving(true);
    const toastId = toast.loading(
      `Saving ${selectedBranchId === 'GLOBAL' ? 'Master TextBee' : `Branch [${selectedBranchId}]`} configuration...`
    );

    const selectedBranchObj = branches.find((b) => b.id === selectedBranchId);
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'SAVE_GATEWAY',
          branchId: selectedBranchId === 'GLOBAL' ? 'GLOBAL' : selectedBranchId,
          branchName: selectedBranchObj?.name || selectedBranchId,
          deviceId: deviceId.trim(),
          apiKey: apiKeyInput.trim() || undefined,
          clearApiKey,
          simSlot: parseInt(simSlot, 10) || 0,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save configuration');

      toast.success(
        `Connected ${selectedBranchId === 'GLOBAL' ? 'Master Gateway' : `${selectedBranchObj?.name || selectedBranchId} SIM`}`,
        { id: toastId }
      );
      setApiKeyInput('');
      setClearApiKey(false);
      await loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Error saving settings'), { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveBranchOverride = async (targetBranch = selectedBranchId) => {
    if (!isAdmin || targetBranch === 'GLOBAL') return;
    setSaving(true);
    const toastId = toast.loading(`Removing branch override for ${targetBranch}...`);
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'REMOVE_BRANCH', branchId: targetBranch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove branch config');
      toast.success(`Branch ${targetBranch} now uses the Master Gateway`, { id: toastId });
      if (selectedBranchId === targetBranch) {
        setSelectedBranchId('GLOBAL');
        setTestBranchId('GLOBAL');
      }
      await loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Failed to remove branch override'), { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTriggers = async () => {
    if (!isAdmin) return toast.error('Admin only.');
    setSaving(true);
    const toastId = toast.loading('Saving Auto-SMS Trigger rules...');
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'SAVE_TRIGGERS', triggers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save triggers');
      toast.success('Auto-SMS triggers updated!', { id: toastId });
      await loadSettingsAndLogs({ skipHealth: true });
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Failed to save triggers'), { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplates = async () => {
    if (!isAdmin) return toast.error('Admin only.');
    setSaving(true);
    const toastId = toast.loading('Saving SMS Templates...');
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'SAVE_TEMPLATES', templates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save templates');
      toast.success('Custom SMS templates saved!', { id: toastId });
      await loadSettingsAndLogs({ skipHealth: true });
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Failed to save templates'), { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const applyTestTemplatePreview = (key: SmsTemplateKey) => {
    setTestTemplateKey(key);
    const tmpl = templates[key];
    const branchLabel = testBranchId === 'GLOBAL' ? 'Head Office' : testBranchId;
    const todaySl = getSriLankaDateString();
    if (key === 'RECEIPT') {
      setTestMessage(buildPawnReceiptSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000, dateStr: todaySl, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'APPROVED') {
      setTestMessage(buildPawnApprovedSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'INTEREST') {
      setTestMessage(buildInterestPaymentSms({ customerName: 'Test Customer', ticketNo: '1R 20743', interestAmount: 2750, dateStr: todaySl, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'REDEEM') {
      setTestMessage(buildPawnRedeemSms({ customerName: 'Test Customer', ticketNo: '1R 20743', settlementAmount: 52750, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'REMINDER') {
      setTestMessage(buildPawnReminderSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'FORFEITURE') {
      setTestMessage(buildForfeitureWarningSms({ customerName: 'Test Customer', ticketNo: '1R 20743', principal: 50000, interestDue: 8250, expiryDate: '2026-11-30', branchName: branchLabel, customTemplate: tmpl }));
    } else {
      setTestMessage(buildPawnReturnedSms({ customerName: 'Test Customer', ticketNo: '1R 20743', reason: 'Weight recheck needed', branchName: branchLabel, customTemplate: tmpl }));
    }
  };

  const handleSendTestSms = async () => {
    const phoneCheck = normalizeSriLankaPhone(testPhone);
    if (!phoneCheck.valid) return toast.error(phoneCheck.reason || 'Enter a valid Sri Lankan mobile number.');
    if (!testMessage.trim()) return toast.error('Enter message content.');

    setTesting(true);
    const toastId = toast.loading(`Sending SMS via TextBee (${testBranchId === 'GLOBAL' ? 'Master' : testBranchId})...`);
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          phone: phoneCheck.e164,
          message: testMessage,
          ticketNo: 'TEST-001',
          amount: 50000,
          type: 'TEST',
          branchId: testBranchId,
          forceGlobal: testBranchId === 'GLOBAL',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch SMS');

      if (data.status === 'SENT') {
        toast.success(`SMS Sent to ${data.phone}`, { description: data.notice, id: toastId });
      } else if (data.status === 'QUEUED') {
        toast.warning('SMS Queued (Limit / Timeout)', { description: data.notice, id: toastId });
      } else {
        toast.error(`SMS Failed (${data.status})`, { description: data.error || data.notice, id: toastId });
      }
      loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Error sending SMS'), { id: toastId });
    } finally {
      setTesting(false);
    }
  };

  const handleRetrySingle = async (logId: string) => {
    setRetryingId(logId);
    const toastId = toast.loading('Retrying SMS via TextBee...');
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'RETRY', logId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Retry delivered successfully!', { description: data.notice, id: toastId });
      } else {
        toast.error(data.error || data.notice || 'Retry failed', { id: toastId });
      }
      await loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Retry request failed'), { id: toastId });
    } finally {
      setRetryingId(null);
    }
  };

  const handleRetryPendingBatch = async () => {
    setBatchRetrying(true);
    const toastId = toast.loading('Retrying up to 10 pending SMS...');
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'RETRY_PENDING',
          branchId: logBranchFilter,
          lookbackHours: 168,
          limit: 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch retry failed');
      if (data.attempted === 0) {
        toast.info('No pending SMS within the last 7 days. Use row Retry for older logs.', { id: toastId });
      } else {
        toast.success(`Batch Retry Complete: ${data.sentCount} sent / ${data.attempted} attempted`, {
          description: data.failedCount > 0 ? `${data.failedCount} still pending.` : 'Batch delivered cleanly.',
          id: toastId,
        });
      }
      await loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Batch retry error'), { id: toastId });
    } finally {
      setBatchRetrying(false);
    }
  };

  const loadBulkRecipients = async () => {
    setBulkLoading(true);
    try {
      const params = new URLSearchParams({ status: 'ACTIVE' });
      if (bulkBranch && bulkBranch !== 'ALL') {
        params.set('branchId', bulkBranch);
      }
      const res = await fetch(`/api/pawns?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load active pawn bills');
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.pawns || data.items || []);
      setBulkPawns(list as PawnRecipientRow[]);
      setSelectedPawnIds(new Set());
      setBulkSummary(null);
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Could not load active loans'));
    } finally {
      setBulkLoading(false);
    }
  };

  const filteredBulkPawns = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return bulkPawns
      .filter((p) => {
        if (String(p.branch_id || '').toUpperCase() === 'TEST') return false;
        if (!q) return true;
        const name = String(p.client_name || p.customer_name || p.clients?.first_name || '').toLowerCase();
        const bill = String(p.bill_no || p.display_bill_no || '').toLowerCase();
        const phone = String(p.phone || p.client_phone || p.clients?.phone || '').toLowerCase();
        return name.includes(q) || bill.includes(q) || phone.includes(q);
      })
      .slice(0, 120);
  }, [bulkPawns, bulkSearch]);

  const bulkLimit = quota?.bulkSendLimit || 50;

  const toggleSelectPawn = (id: string, validPhone: boolean) => {
    if (!validPhone) return;
    setSelectedPawnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < bulkLimit) next.add(id);
      else toast.warning(`Maximum ${bulkLimit} recipients per TextBee batch.`);
      return next;
    });
  };

  const selectAllValidBulk = () => {
    const validIds = filteredBulkPawns
      .filter((p) => normalizeSriLankaPhone(p.phone || p.client_phone || p.clients?.phone).valid)
      .slice(0, bulkLimit)
      .map((p) => p.id);
    if (selectedPawnIds.size === validIds.length && validIds.length > 0) {
      setSelectedPawnIds(new Set());
    } else {
      setSelectedPawnIds(new Set(validIds));
    }
  };

  const handleSendBulkReminders = async () => {
    if (selectedPawnIds.size === 0) return toast.error('Select at least one customer loan.');
    const chosen = bulkPawns.filter((p) => selectedPawnIds.has(p.id));
    setBulkSending(true);
    const toastId = toast.loading(`Sending bulk reminders to ${chosen.length} customers...`);
    try {
      const recipients = chosen.map((p) => ({
        phone: p.phone || p.client_phone || p.clients?.phone,
        customerName: p.client_name || p.customer_name || `${p.clients?.first_name || ''} ${p.clients?.last_name || ''}`.trim() || 'Valued Customer',
        ticketNo: p.display_bill_no || p.bill_no || p.id.slice(0, 8),
        amount: p.disbursed_amount || 0,
        branchId: p.branch_id || userBranchId,
      }));

      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mode: 'BULK',
          templateKey: bulkTemplateKey,
          customMessage: bulkCustomMsg,
          type: bulkTemplateKey === 'FORFEITURE' ? 'FORFEITURE' : 'REMINDER',
          recipients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk SMS dispatch failed');

      setBulkSummary(data);
      toast.success(`Bulk Complete: ${data.sentCount} Sent, ${data.queuedCount} Queued, ${data.failedCount} Failed`, { id: toastId });
      await loadSettingsAndLogs();
    } catch (err: unknown) {
      toast.error(getErrText(err, 'Bulk dispatch error'), { id: toastId });
    } finally {
      setBulkSending(false);
    }
  };

  const phoneCheck = useMemo(() => (testPhone.trim() ? normalizeSriLankaPhone(testPhone) : null), [testPhone]);
  const testSmsParts = useMemo(() => calculateSmsParts(testMessage), [testMessage]);
  const templateParts = useMemo(() => calculateSmsParts(templates[activeTemplateKey] || ''), [templates, activeTemplateKey]);

  const activeBranchList = useMemo(
    () => (isHead ? branches : branches.filter((b) => normalizeBranchId(b.id) === normalizeBranchId(userBranchId))),
    [branches, isHead, userBranchId]
  );

  const customBranchKeys = useMemo(
    () => Object.entries(branchConfigs).filter(([, v]) => Boolean(v?.deviceId)),
    [branchConfigs]
  );

  const dailyPct = quota ? Math.min(100, Math.max(0, quota.dailyUsagePercentage)) : 0;
  const monthlyPct = quota ? Math.min(100, Math.max(0, quota.monthlyUsagePercentage)) : 0;
  const gatewayEnabled = globalConfig.enabled !== false;

  return (
    <div className="space-y-5 animate-in slide-in-from-bottom-4 duration-500 pb-16 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-5 sm:p-6 rounded-3xl border-white/40 shadow-xl gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className={`p-3 rounded-2xl border shrink-0 ${health?.online && gatewayEnabled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-amber-500/10 border-amber-500/20 text-amber-600'}`}>
            <Smartphone className="w-7 h-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                TextBee <span className="bg-gradient-to-r from-amber-500 to-yellow-600 bg-clip-text text-transparent">SMS Gateway</span>
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                !gatewayEnabled
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : health?.online
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {!gatewayEnabled ? 'PAUSED' : (health?.status || (loading ? 'CHECKING...' : 'READY'))}
              </span>
              {quota && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-900 text-[#ffd100]">
                  {quota.planName} PLAN
                </span>
              )}
              {!isAdmin && (
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Read Only
                </span>
              )}
            </div>
            <p className="text-slate-500 font-semibold text-xs mt-1">
              Simple Android TextBee SMS control, live daily/monthly limits, quick testing, auto-receipts & retry queue.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {isAdmin && (
            <Button
              onClick={handleToggleGateway}
              disabled={saving}
              variant="outline"
              className={`h-10 px-4 font-black rounded-2xl text-xs cursor-pointer gap-1.5 ${
                gatewayEnabled
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <Power className="w-4 h-4" />
              {gatewayEnabled ? 'SMS ON' : 'SMS OFF (Enable)'}
            </Button>
          )}
          <Button
            onClick={() => fetchLiveHealth(selectedBranchId, false)}
            disabled={healthLoading}
            variant="outline"
            className="h-10 px-4 bg-white border-slate-200 text-slate-800 hover:bg-slate-50 font-bold rounded-2xl text-xs cursor-pointer"
          >
            <Activity className={`w-4 h-4 mr-1.5 ${healthLoading ? 'animate-pulse text-emerald-600' : 'text-emerald-600'}`} />
            Check Phone & Limits
          </Button>
          <Button
            onClick={() => loadSettingsAndLogs()}
            variant="outline"
            className="h-10 px-3.5 bg-white border-slate-200 text-slate-700 font-bold rounded-2xl text-xs cursor-pointer"
          >
            <RefreshCcw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin text-amber-500' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Live Status & SMS Limit Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Phone Health */}
        <Card className={`rounded-2xl p-4 border shadow-sm ${
          health?.online && gatewayEnabled
            ? 'bg-emerald-50/70 border-emerald-200'
            : health?.status === 'ERROR' || health?.status === 'NOT_CONFIGURED' || !gatewayEnabled
            ? 'bg-rose-50/70 border-rose-200'
            : 'glass border-white/40'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Connected Phone</p>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
              health?.online && gatewayEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
            }`}>
              {!gatewayEnabled ? 'PAUSED' : (health?.status || (healthLoading ? 'PINGING' : 'PENDING'))}
            </span>
          </div>
          <p className="text-sm font-black text-slate-900 mt-1.5 truncate">
            {health?.model ? `${health.brand || ''} ${health.model}`.trim() : (globalConfig.deviceId ? `Device ••••${globalConfig.deviceId.slice(-4)}` : 'No Device Linked')}
          </p>
          {health && !health.error ? (
            <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-semibold text-slate-600 mt-1.5">
              <span className="inline-flex items-center gap-1">
                {health.isCharging ? <BatteryCharging className="w-3.5 h-3.5 text-emerald-600" /> : <Battery className="w-3.5 h-3.5" />}
                {health.batteryPercentage ?? '—'}%
              </span>
              <span className="inline-flex items-center gap-1">
                <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                {health.networkType || '—'}
              </span>
              <span>{health.heartbeatAgeMinutes !== null && health.heartbeatAgeMinutes !== undefined ? `${health.heartbeatAgeMinutes}m ago` : '—'}</span>
            </div>
          ) : (
            <p className="text-[11px] font-semibold text-rose-700 mt-1.5 truncate" title={health?.error || ''}>
              {health?.error || 'Link TextBee Device ID & API Key below.'}
            </p>
          )}
        </Card>

        {/* Card 2: Daily SMS Limit */}
        <Card className="glass border-white/40 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Daily SMS Limit</p>
            <Gauge className="w-4 h-4 text-indigo-500" />
          </div>
          {quota ? (
            <>
              <div className="flex items-baseline justify-between mt-1">
                <p className={`text-2xl font-black ${quota.dailyRemaining <= 0 ? 'text-rose-600' : quota.dailyRemaining <= 10 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {Math.max(0, quota.dailyRemaining)} <span className="text-xs font-bold text-slate-500">/ {quota.dailyLimit} left</span>
                </p>
                <span className="text-[11px] font-mono font-bold text-slate-500">{dailyPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mt-2">
                <div
                  className={`h-full transition-all ${dailyPct >= 95 ? 'bg-rose-600' : dailyPct >= 70 ? 'bg-amber-500' : 'bg-indigo-600'}`}
                  style={{ width: `${dailyPct}%` }}
                />
              </div>
              <p className="text-[11px] font-semibold text-slate-500 mt-1.5">
                Used today: {quota.processedSmsToday} • Max {quota.bulkSendLimit}/batch
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold text-slate-400 mt-2">
              {healthLoading ? 'Loading TextBee daily quota...' : 'Save valid API Key to show live daily limit.'}
            </p>
          )}
        </Card>

        {/* Card 3: Monthly SMS Limit */}
        <Card className={`rounded-2xl p-4 border shadow-sm ${
          quota && quota.monthlyRemaining <= 0
            ? 'bg-rose-50 border-rose-300'
            : quota && quota.monthlyRemaining <= 40
            ? 'bg-amber-50/80 border-amber-200'
            : 'glass border-white/40'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly SMS Limit</p>
            {quota && (
              <span className="text-[10px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                Resets {formatResetDate(quota.monthlyResetAt)}
              </span>
            )}
          </div>
          {quota ? (
            <>
              <div className="flex items-baseline justify-between mt-1">
                <p className={`text-2xl font-black ${quota.monthlyRemaining <= 0 ? 'text-rose-600' : quota.monthlyRemaining <= 40 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {Math.max(0, quota.monthlyRemaining)} <span className="text-xs font-bold text-slate-500">/ {quota.monthlyLimit} left</span>
                </p>
                <span className="text-[11px] font-mono font-bold text-slate-500">{monthlyPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mt-2">
                <div
                  className={`h-full transition-all ${monthlyPct >= 95 ? 'bg-rose-600' : monthlyPct >= 75 ? 'bg-amber-500' : 'bg-emerald-600'}`}
                  style={{ width: `${monthlyPct}%` }}
                />
              </div>
              <p className="text-[10px] font-semibold text-slate-500 mt-1.5">
                Used: {quota.processedSmsLastMonth} (sent &amp; received SMS count)
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold text-slate-400 mt-2">
              {healthLoading ? 'Loading monthly allowance...' : 'Save valid API Key to show live monthly limit.'}
            </p>
          )}
        </Card>

        {/* Card 4: Delivery Stats */}
        <Card className="glass border-white/40 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">System SMS Activity</p>
          <div className="flex items-baseline gap-3 mt-1">
            <p className="text-2xl font-black text-emerald-600">{stats.todaySent} <span className="text-xs font-bold text-slate-500">today</span></p>
            <span className="text-xs font-bold text-slate-400">•</span>
            <p className={`text-lg font-black ${stats.retryable7d > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
              {stats.queued + stats.failed} <span className="text-[11px] font-semibold text-slate-500">failed/queued</span>
            </p>
          </div>
          <p className="text-[11px] font-semibold text-slate-500 mt-1.5">
            {Object.values(triggers).filter(Boolean).length}/{SMS_TRIGGER_META.length} Auto-triggers • All Branches → Master
          </p>
        </Card>
      </div>

      {/* Actionable Hardware / Quota Warnings */}
      {quota && (quota.monthlyRemaining <= 0 || quota.dailyRemaining <= 0) && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 flex items-start gap-3 text-rose-900 text-xs font-bold">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-black">TextBee SMS Quota Reached</p>
            <p className="font-semibold text-rose-700 mt-0.5">
              Daily remaining: {quota.dailyRemaining}/{quota.dailyLimit} • Monthly remaining: {quota.monthlyRemaining}/{quota.monthlyLimit}.
              Sending pauses until {formatResetDate(quota.monthlyResetAt)} or upgrade your TextBee plan.
            </p>
          </div>
        </div>
      )}

      {health?.online && ((health.sims && health.sims.length === 0) || health.batteryOptimizationIgnored === false) && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-amber-900 text-xs font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              {health.sims && health.sims.length === 0
                ? 'Device online, but TextBee has not reported an active SIM card yet — confirm SIM is inserted with SMS balance.'
                : 'Android Battery Optimization is still ON on the gateway device — turn battery optimization OFF for TextBee so background SMS never stalls.'}
            </span>
          </div>
          {health.batteryOptimizationIgnored === false && health.sims && health.sims.length === 0 && (
            <span className="text-[10px] font-bold text-amber-700">Tip: Disable Battery Optimization in TextBee app settings</span>
          )}
        </div>
      )}

      {/* Clean Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        {[
          { key: 'gateway', label: 'Device & Quick Test', icon: Server },
          { key: 'dispatch', label: 'Bulk Reminders', icon: Users },
          { key: 'templates', label: 'Auto Triggers & Templates', icon: Sliders },
          { key: 'logs', label: `Logs & Retry (${stats.queued + stats.failed})`, icon: FileText },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as TabKey)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer border ${
              activeTab === key
                ? 'bg-slate-950 text-[#ffd100] border-slate-900 shadow-md'
                : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: SIMPLE SETUP + QUICK TEST SMS */}
      {activeTab === 'gateway' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Simple TextBee Connection Card */}
            <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 lg:col-span-7 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <Server className="w-5 h-5 text-amber-500" />
                  <div>
                    <h2 className="font-black text-base text-slate-900">
                      {selectedBranchId === 'GLOBAL'
                        ? 'Main TextBee Android Phone (All Branches)'
                        : `Branch Override: ${branches.find((b) => b.id === selectedBranchId)?.name || selectedBranchId}`}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      1. Paste API Key → 2. Click Detect Device → 3. Save &amp; Connect.
                    </p>
                  </div>
                </div>
                {selectedBranchId !== 'GLOBAL' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleBranchSelect('GLOBAL')}
                    className="h-8 px-3 rounded-xl text-[11px] font-bold cursor-pointer"
                  >
                    Back to Main Phone
                  </Button>
                )}
              </div>

              <div className="space-y-4">
                {/* Step 1: API Key + Detect */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-700">1. TextBee API Key</Label>
                    {hasSavedKey && !clearApiKey && (
                      <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        Saved ({savedMaskedKey})
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value);
                        if (e.target.value) setClearApiKey(false);
                      }}
                      disabled={!isAdmin}
                      type="password"
                      placeholder={
                        clearApiKey
                          ? 'Key will be cleared on Save'
                          : hasSavedKey
                          ? `Keep existing (${savedMaskedKey}) or paste new key`
                          : 'Paste TextBee API Key (txb_...)'
                      }
                      className="h-11 rounded-xl bg-white font-mono text-xs flex-1"
                    />
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={discovering}
                        onClick={handleDiscoverDevices}
                        className="h-11 px-4 rounded-xl text-xs font-black border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 shrink-0 cursor-pointer gap-1.5"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${discovering ? 'animate-spin' : ''}`} />
                        {discovering ? 'Checking...' : 'Detect Device'}
                      </Button>
                    )}
                    {isAdmin && hasSavedKey && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setClearApiKey(!clearApiKey);
                          setApiKeyInput('');
                        }}
                        className="h-11 px-3 rounded-xl text-xs font-bold border-rose-200 text-rose-600 hover:bg-rose-50 shrink-0 cursor-pointer"
                      >
                        {clearApiKey ? 'Undo' : 'Clear'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Detected Devices Picker */}
                {discoveredDevices.length > 0 && (
                  <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-2">
                    <p className="text-[11px] font-black text-emerald-900">Select Detected Android Device:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {discoveredDevices.map((dev) => {
                        const selected = deviceId.trim() === dev.id;
                        return (
                          <button
                            key={dev.id}
                            type="button"
                            onClick={() => setDeviceId(dev.id)}
                            className={`text-left p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 cursor-pointer transition-all ${
                              selected ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20' : 'bg-white/70 border-slate-200 hover:bg-white'
                            }`}
                          >
                            <div>
                              <p className="font-black text-slate-900">{dev.name} {dev.osVersion ? `(Android ${dev.osVersion})` : ''}</p>
                              <p className="text-[10px] font-mono text-slate-500">ID: ••••{dev.id.slice(-6)} • Battery {dev.batteryPercentage ?? '?'}% • App v{dev.appVersion || '?'}</p>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${dev.online ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                              {dev.online ? 'ONLINE' : 'STALE'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Step 2: Device ID + SIM Slot */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-slate-700">2. TextBee Device ID</Label>
                    <Input
                      value={deviceId}
                      onChange={(e) => setDeviceId(e.target.value)}
                      disabled={!isAdmin}
                      placeholder="Auto-filled or paste Device ID..."
                      className="h-11 rounded-xl bg-white font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-slate-700">3. SIM Selection</Label>
                    <select
                      value={simSlot}
                      onChange={(e) => setSimSlot(e.target.value)}
                      disabled={!isAdmin}
                      className="w-full h-11 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                    >
                      <option value="0">Auto / Device Default SIM (Recommended)</option>
                      <option value="1">SIM Slot 1</option>
                      <option value="2">SIM Slot 2</option>
                    </select>
                  </div>
                </div>

                {/* Gateway Active Toggle + Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!isAdmin}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    Gateway Enabled for Dispatch
                  </label>

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedBranchId !== 'GLOBAL' && branchConfigs[normalizeBranchId(selectedBranchId)] && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={saving}
                          onClick={() => handleRemoveBranchOverride(selectedBranchId)}
                          className="h-10 px-3.5 rounded-xl text-xs font-bold border-rose-200 text-rose-700 hover:bg-rose-50 gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove Override
                        </Button>
                      )}
                      <Button
                        onClick={handleSaveConfig}
                        disabled={saving}
                        className="h-11 px-6 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs gap-2 shadow-md cursor-pointer"
                      >
                        <Save className="w-4 h-4" />
                        Save &amp; Connect
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Quick Send Test SMS Card (Right Alongside Setup) */}
            <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 lg:col-span-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <MessageSquare className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="font-black text-base text-slate-900">Quick Send / Test SMS</h2>
                  <p className="text-[11px] text-slate-500">Test delivery on your phone right after saving.</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Mobile Number</Label>
                    <Input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="0771234567"
                      className="h-10 rounded-xl bg-white font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-slate-700">Template Preset</Label>
                    <select
                      value={testTemplateKey}
                      onChange={(e) => applyTestTemplatePreview(e.target.value as SmsTemplateKey)}
                      className="w-full h-10 px-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                    >
                      {(Object.keys(SMS_TEMPLATE_LABELS) as SmsTemplateKey[]).map((k) => (
                        <option key={k} value={k}>
                          {SMS_TEMPLATE_LABELS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {phoneCheck && (
                  <p className={`text-[11px] font-mono ${phoneCheck.valid ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {phoneCheck.valid ? `Ready: ${phoneCheck.e164}` : phoneCheck.reason}
                  </p>
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-700">Message Preview</Label>
                    <span className={`text-[10px] font-mono font-bold ${testSmsParts.parts > 2 ? 'text-amber-600' : 'text-slate-500'}`}>
                      {testSmsParts.chars} chars • {testSmsParts.parts} SMS ({testSmsParts.encoding})
                    </span>
                  </div>
                  <textarea
                    rows={5}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>

                <Button
                  onClick={handleSendTestSms}
                  disabled={testing || !phoneCheck?.valid || !gatewayEnabled}
                  className="w-full h-11 bg-slate-950 hover:bg-slate-800 text-white font-bold rounded-xl text-xs gap-2 shadow-md cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {testing ? 'Sending...' : 'Send Test SMS Now'}
                </Button>
              </div>
            </Card>
          </div>

          {/* Collapsible Optional Per-Branch Overrides (Hidden by Default to Keep UI Simple) */}
          {isHead && (
            <Card className="glass border-white/40 shadow-sm rounded-3xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowBranchOverrides((prev) => !prev)}
                className="w-full px-5 py-4 flex items-center justify-between gap-2 text-left hover:bg-white/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  {showBranchOverrides ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  <Building2 className="w-4 h-4 text-amber-500" />
                  <div>
                    <p className="text-xs font-black text-slate-900">
                      Optional: Separate Branch Phones ({customBranchKeys.length} custom override{customBranchKeys.length === 1 ? '' : 's'})
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Currently all branches use your Main TextBee Device automatically. Only open if a branch uses its own tablet SIM.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-amber-700 shrink-0">
                  {showBranchOverrides ? 'Hide' : 'Configure Branch SIMs'}
                </span>
              </button>

              {showBranchOverrides && (
                <CardContent className="p-0 border-t border-slate-100">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-slate-950 text-white">
                        <TableRow className="hover:bg-slate-900 border-slate-800">
                          <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-3 pl-5">Branch</TableHead>
                          <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Device</TableHead>
                          <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Mode</TableHead>
                          <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 pr-5 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="divide-y divide-slate-100">
                        {activeBranchList.map((b) => {
                          const norm = normalizeBranchId(b.id);
                          const bConf = branchConfigs[norm] || branchConfigs[b.id];
                          const hasCustom = Boolean(bConf?.deviceId);
                          return (
                            <TableRow key={b.id} className="hover:bg-slate-50">
                              <TableCell className="pl-5 font-bold text-xs text-slate-900">
                                {b.name || b.id} <span className="font-mono text-[10px] text-slate-400">({norm})</span>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-slate-600">
                                {bConf?.deviceId ? `••••${bConf.deviceId.slice(-6)}` : (globalConfig.deviceId ? `Master (••••${globalConfig.deviceId.slice(-4)})` : 'Not Configured')}
                              </TableCell>
                              <TableCell>
                                {hasCustom ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-black">
                                    <CheckCircle2 className="w-3 h-3" /> CUSTOM BRANCH SIM
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-black">
                                    <Radio className="w-3 h-3" /> MASTER SHARED
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="pr-5 text-right">
                                <div className="flex justify-end gap-1.5">
                                  {hasCustom && isAdmin && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleRemoveBranchOverride(b.id)}
                                      className="h-8 px-2.5 text-[11px] font-bold text-rose-700 border-rose-200 rounded-xl cursor-pointer"
                                    >
                                      Use Master
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleBranchSelect(b.id)}
                                    className="h-8 px-3 text-[11px] font-black text-amber-700 bg-amber-50 border-amber-300 rounded-xl cursor-pointer"
                                  >
                                    Set Custom
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      )}

      {/* TAB 2: BULK REMINDERS */}
      {activeTab === 'dispatch' && (
        <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-500" />
              <div>
                <h2 className="font-black text-base text-slate-900">Bulk Active Loan Reminders (Max {bulkLimit} / batch)</h2>
                <p className="text-xs text-slate-500">
                  Load active loans, select valid numbers, and send personalized reminders.
                  {quota ? ` Monthly remaining: ${quota.monthlyRemaining} SMS.` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkBranch}
                onChange={(e) => setBulkBranch(e.target.value)}
                disabled={!isHead}
                className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
              >
                {isHead && <option value="ALL">All Branches</option>}
                {activeBranchList.map((b) => (
                  <option key={b.id} value={b.id}>{b.name || b.id} ({normalizeBranchId(b.id)})</option>
                ))}
              </select>
              <Button
                onClick={loadBulkRecipients}
                disabled={bulkLoading}
                variant="outline"
                className="h-9 px-3.5 rounded-xl text-xs font-bold cursor-pointer"
              >
                <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${bulkLoading ? 'animate-spin' : ''}`} />
                Load Active Loans
              </Button>
            </div>
          </div>

          {bulkSummary && (
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex flex-wrap gap-4">
              <span>Total: {bulkSummary.total}</span>
              <span className="text-emerald-700">Sent: {bulkSummary.sentCount}</span>
              <span className="text-amber-700">Queued: {bulkSummary.queuedCount}</span>
              <span className="text-rose-700">Failed/Invalid: {bulkSummary.failedCount + bulkSummary.invalidCount}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Filter Recipients</Label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <Input
                  value={bulkSearch}
                  onChange={(e) => setBulkSearch(e.target.value)}
                  placeholder="Search bill #, customer name, or phone..."
                  className="h-9 pl-8 rounded-xl bg-white text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Bulk Template Base</Label>
              <select
                value={bulkTemplateKey}
                onChange={(e) => {
                  const k = e.target.value as SmsTemplateKey;
                  setBulkTemplateKey(k);
                  setBulkCustomMsg(templates[k] || DEFAULT_SMS_TEMPLATES[k]);
                }}
                className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
              >
                <option value="REMINDER">Payment Reminder</option>
                <option value="INTEREST">Interest Reminder / Notice</option>
                <option value="FORFEITURE">Overdue Warning</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-slate-700">
                Message Pattern ({'{{customer_name}}, {{ticket_no}}, {{amount}}, {{branch_name}}'})
              </Label>
              <span className="text-[10px] font-mono text-slate-500">
                ~{calculateSmsParts(bulkCustomMsg).parts} SMS parts/msg ({calculateSmsParts(bulkCustomMsg).encoding})
              </span>
            </div>
            <textarea
              rows={4}
              value={bulkCustomMsg}
              onChange={(e) => setBulkCustomMsg(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={selectAllValidBulk}
              disabled={filteredBulkPawns.length === 0}
              className="h-8 px-3 rounded-xl text-xs font-bold cursor-pointer"
            >
              {selectedPawnIds.size > 0 ? 'Clear Selection' : `Select All Valid (Max ${bulkLimit})`}
            </Button>
            <Button
              type="button"
              onClick={handleSendBulkReminders}
              disabled={bulkSending || selectedPawnIds.size === 0 || !gatewayEnabled}
              className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Send Bulk Reminders ({selectedPawnIds.size})
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto border border-slate-200 rounded-2xl bg-white/70">
            <Table>
              <TableHeader className="bg-slate-900 text-white">
                <TableRow>
                  <TableHead className="w-10 text-slate-300 text-[10px]">Pick</TableHead>
                  <TableHead className="text-slate-300 text-[10px] uppercase">Bill #</TableHead>
                  <TableHead className="text-slate-300 text-[10px] uppercase">Customer</TableHead>
                  <TableHead className="text-slate-300 text-[10px] uppercase">Phone</TableHead>
                  <TableHead className="text-slate-300 text-[10px] uppercase text-right">Principal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {filteredBulkPawns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-xs text-slate-400 font-semibold">
                      Click &quot;Load Active Loans&quot; above to view eligible customers.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBulkPawns.map((p) => {
                    const rawPhone = p.phone || p.client_phone || p.clients?.phone || '';
                    const pNorm = normalizeSriLankaPhone(rawPhone);
                    const checked = selectedPawnIds.has(p.id);
                    const name = p.client_name || p.customer_name || `${p.clients?.first_name || ''} ${p.clients?.last_name || ''}`.trim() || 'Unknown';
                    return (
                      <TableRow
                        key={p.id}
                        onClick={() => toggleSelectPawn(p.id, pNorm.valid)}
                        className={`cursor-pointer ${!pNorm.valid ? 'opacity-50' : checked ? 'bg-amber-50/70' : 'hover:bg-slate-50'}`}
                      >
                        <TableCell>
                          {checked ? <CheckSquare className="w-4 h-4 text-amber-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-slate-900">
                          {p.display_bill_no || p.bill_no} <span className="text-[10px] text-slate-400">[{normalizeBranchId(p.branch_id)}]</span>
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-slate-800">{name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {pNorm.valid ? (
                            <span className="text-emerald-700 font-bold">{pNorm.e164}</span>
                          ) : (
                            <span className="text-rose-600 text-[11px]">Invalid/Missing</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold">
                          Rs. {(Number(p.disbursed_amount) || 0).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* TAB 3: AUTO TRIGGERS & TEMPLATES */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-black text-base text-slate-900">Automated SMS Triggers</h2>
                <p className="text-xs text-slate-500">Turn individual customer notifications On or Off.</p>
              </div>
              {isAdmin && (
                <Button
                  onClick={handleSaveTriggers}
                  disabled={saving}
                  size="sm"
                  className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save Triggers
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {SMS_TRIGGER_META.map((item) => {
                const active = triggers[item.key];
                return (
                  <label
                    key={item.key}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-2xl border cursor-pointer transition-colors ${
                      active ? 'bg-emerald-50/50 border-emerald-200' : 'bg-white/70 border-slate-200'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-black text-slate-900">{item.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={active}
                      disabled={!isAdmin}
                      onChange={(e) => setTriggers((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                      className="w-4 h-4 mt-1 accent-emerald-600 shrink-0"
                    />
                  </label>
                );
              })}
            </div>
          </Card>

          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-black text-base text-slate-900">SMS Template Editor</h2>
                <p className="text-xs text-slate-500">Keep English-only for 1–2 GSM segments, or include Sinhala/Tamil.</p>
              </div>
              {isAdmin && (
                <Button
                  onClick={handleSaveTemplates}
                  disabled={saving}
                  size="sm"
                  className="h-9 px-4 bg-slate-950 hover:bg-slate-800 text-white font-black rounded-xl text-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save Templates
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SMS_TEMPLATE_LABELS) as SmsTemplateKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveTemplateKey(k)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black border cursor-pointer ${
                    activeTemplateKey === k
                      ? 'bg-amber-500 text-slate-950 border-amber-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {SMS_TEMPLATE_LABELS[k].label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-bold text-slate-700">
                  Template: {SMS_TEMPLATE_LABELS[activeTemplateKey].label}
                </Label>
                <span className={`text-[10px] font-mono font-bold ${templateParts.parts > 2 ? 'text-amber-600' : 'text-emerald-700'}`}>
                  {templateParts.chars} chars • {templateParts.parts} SMS parts ({templateParts.encoding})
                </span>
              </div>
              <textarea
                rows={8}
                disabled={!isAdmin}
                value={templates[activeTemplateKey] || ''}
                onChange={(e) =>
                  setTemplates((prev) => ({ ...prev, [activeTemplateKey]: e.target.value }))
                }
                className="w-full p-3 rounded-2xl bg-white border border-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {SMS_TEMPLATE_LABELS[activeTemplateKey].placeholders.map((ph) => (
                    <button
                      key={ph}
                      type="button"
                      disabled={!isAdmin}
                      onClick={() =>
                        setTemplates((prev) => ({ ...prev, [activeTemplateKey]: (prev[activeTemplateKey] || '') + ` ${ph}` }))
                      }
                      className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[10px] font-mono font-bold text-slate-700 cursor-pointer"
                    >
                      + {ph}
                    </button>
                  ))}
                </div>
                {isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTemplates((prev) => ({
                        ...prev,
                        [activeTemplateKey]: DEFAULT_SMS_TEMPLATES[activeTemplateKey],
                      }))
                    }
                    className="h-7 px-2.5 text-[11px] font-bold rounded-lg cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Reset Default
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: DISPATCH LOGS & RETRY QUEUE */}
      {activeTab === 'logs' && (
        <Card className="glass border-white/40 shadow-xl rounded-3xl overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-base text-slate-900">SMS Dispatch Logs &amp; Retry Queue</h2>
              <p className="text-xs text-slate-500">Live branch-scoped delivery history with TextBee responses and retry controls.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                loadSettingsAndLogs();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <Input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search phone or message..."
                className="h-9 w-48 rounded-xl bg-white text-xs"
              />
              <select
                value={logStatusFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setLogStatusFilter(v);
                  loadSettingsAndLogs({ status: v });
                }}
                className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
              >
                <option value="ALL">All Status</option>
                <option value="SENT">SENT</option>
                <option value="QUEUED">QUEUED</option>
                <option value="FAILED">FAILED</option>
              </select>
              {isHead && (
                <select
                  value={logBranchFilter}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLogBranchFilter(v);
                    loadSettingsAndLogs({ branch: v });
                  }}
                  className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                >
                  <option value="ALL">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name || b.id} ({normalizeBranchId(b.id)})</option>
                  ))}
                </select>
              )}
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-9 px-3 rounded-xl text-xs font-bold cursor-pointer"
              >
                Search
              </Button>
              {stats.retryable7d > 0 && (
                <Button
                  type="button"
                  size="sm"
                  disabled={batchRetrying || !gatewayEnabled}
                  onClick={handleRetryPendingBatch}
                  className="h-9 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs gap-1.5 cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${batchRetrying ? 'animate-spin' : ''}`} />
                  Retry Recent ({Math.min(stats.retryable7d, 10)})
                </Button>
              )}
            </form>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-950 text-white">
                  <TableRow className="hover:bg-slate-900 border-slate-800">
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-3.5 pl-5">Timestamp</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Branch</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Mobile</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Ticket / Type</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Message</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Status &amp; Notice</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 pr-5 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100">
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 font-bold text-sm">
                        No SMS dispatch logs found for this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log, idx) => {
                      const dateStr = log.created_at
                        ? new Date(log.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })
                        : '—';
                      const isSent = log.status === 'SENT';
                      const canRetry = (log.status === 'QUEUED' || log.status === 'FAILED') && Boolean(log.id);
                      return (
                        <TableRow key={log.id || `log-${idx}`} className="hover:bg-slate-50">
                          <TableCell className="pl-5 font-mono text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                            {dateStr}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-amber-600">
                            {normalizeBranchId(log.branch_id || 'HQ')}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-slate-900 whitespace-nowrap">
                            {log.phone || log.recipient_phone || '—'}
                          </TableCell>
                          <TableCell className="font-mono text-[11px]">
                            <div className="font-bold text-slate-800">{log.ticket_no || '—'}</div>
                            <span className="text-[10px] text-slate-400">{log.type || 'SMS'}</span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-700 max-w-xs truncate" title={log.message || log.message_text}>
                            {log.message || log.message_text || '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 max-w-xs">
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider ${
                                  isSent ? 'text-emerald-600' : log.status === 'QUEUED' ? 'text-amber-600' : 'text-rose-600'
                                }`}
                              >
                                {isSent ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                {log.status} {log.attempts > 1 ? `(${log.attempts}x)` : ''}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono truncate" title={log.error || log.notice}>
                                {log.error || log.notice || '—'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {canRetry && log.id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={retryingId === log.id || !gatewayEnabled}
                                onClick={() => handleRetrySingle(log.id!)}
                                className="h-7 px-2.5 text-[11px] font-bold text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-lg cursor-pointer"
                              >
                                <RotateCcw className={`w-3 h-3 mr-1 ${retryingId === log.id ? 'animate-spin' : ''}`} />
                                Retry
                              </Button>
                            ) : (
                              <span className="text-[10px] font-mono text-slate-400">Done</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
