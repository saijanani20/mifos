import { adminSupabase } from '@/lib/auth-server';
import { getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';
import {
  DEFAULT_SMS_TRIGGERS,
  SmsTemplateKey,
  SmsTemplatesConfig,
  SmsTriggerKey,
  SmsTriggersConfig,
  SmsType,
  normalizeSriLankaPhone,
} from '@/lib/sms-templates';

export * from '@/lib/sms-templates';

export interface BranchSmsConfig {
  branchId: string;
  branchName?: string;
  email?: string;
  deviceId?: string;
  apiKey?: string;
  gatewayUrl?: string;
  simSlot?: number; // 0 = Device Default SIM, 1 = SIM 1, 2 = SIM 2
  enabled?: boolean;
  updatedAt?: string;
}

export interface SmsGatewayConfig {
  enabled: boolean;
  provider: 'TEXTBEE';
  email?: string;
  deviceId: string;
  apiKey: string;
  gatewayUrl: string;
  simSlot: number; // 0 = Device Default SIM, 1 = SIM 1, 2 = SIM 2
  branches: Record<string, BranchSmsConfig>;
  triggers: SmsTriggersConfig;
  templates: SmsTemplatesConfig;
  updatedAt?: string;
}

export interface SendSmsParams {
  phone: string;
  message: string;
  ticketNo?: string;
  amount?: number;
  type?: SmsType;
  branchId?: string;
  forceGlobal?: boolean;
  triggerKey?: SmsTriggerKey;
  skipTriggerCheck?: boolean;
  dryRun?: boolean;
}

export interface SendSmsResult {
  success: boolean;
  status: 'SENT' | 'QUEUED' | 'FAILED' | 'DISABLED' | 'INVALID_PHONE' | 'NOT_CONFIGURED' | 'SKIPPED';
  logId?: string | null;
  phone: string;
  branchId?: string;
  notice?: string;
  error?: string;
  httpStatus?: number | null;
  usedBranchDevice?: boolean;
}

export interface TextBeeSimInfo {
  slot: number;
  subscriptionId?: number | null;
  carrier: string;
  displayName: string;
  serviceState?: string | null;
  signalLevel?: number | null;
}

export interface TextBeeQuotaStatus {
  planName: string;
  isActive: boolean;
  paymentHold: boolean;
  dailyLimit: number;
  dailyRemaining: number;
  processedSmsToday: number;
  dailyUsagePercentage: number;
  monthlyLimit: number;
  monthlyRemaining: number;
  processedSmsLastMonth: number;
  monthlyUsagePercentage: number;
  bulkSendLimit: number;
  deviceLimit: number;
  monthlyPeriodStart?: string | null;
  monthlyResetAt?: string | null;
  totalDeviceCount?: number | null;
  totalSentAllTime?: number | null;
  totalReceivedAllTime?: number | null;
}

export interface TextBeeHealthStatus {
  configured: boolean;
  enabled: boolean;
  online: boolean;
  status: 'ONLINE' | 'STALE' | 'DISABLED' | 'ERROR' | 'NOT_CONFIGURED';
  branchId: string;
  usedBranchDevice: boolean;
  deviceIdTail?: string;
  deviceName?: string | null;
  brand?: string | null;
  model?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  lastHeartbeat?: string | null;
  heartbeatAgeMinutes?: number | null;
  batteryPercentage?: number | null;
  isCharging?: boolean | null;
  networkType?: string | null;
  sentSMSCount?: number | null;
  receivedSMSCount?: number | null;
  receiveSMSEnabled?: boolean | null;
  batteryOptimizationIgnored?: boolean | null;
  permissionsOk?: boolean | null;
  sims?: TextBeeSimInfo[];
  quota?: TextBeeQuotaStatus | null;
  error?: string | null;
}

export interface TextBeeDiscoveredDevice {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  enabled: boolean;
  isDefault?: boolean;
  osVersion?: string | null;
  appVersion?: string | null;
  lastHeartbeat?: string | null;
  heartbeatAgeMinutes?: number | null;
  online: boolean;
  batteryPercentage?: number | null;
  isCharging?: boolean | null;
  networkType?: string | null;
  sentSMSCount?: number | null;
  sims: TextBeeSimInfo[];
}

export interface FormattedSmsLogRow {
  id?: string;
  branch_id: string;
  phone: string;
  recipient_phone: string;
  message: string;
  message_text: string;
  ticket_no: string | null;
  amount: number | null;
  type: string;
  status: string;
  notice: string;
  dispatch_notice: string;
  error: string | null;
  http_status: number | null;
  attempts: number;
  sim_slot: number | null;
  used_branch_device: boolean;
  device_id_tail: string | null;
  retried_at: string | null;
  created_at?: string;
}

function getErrMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export function parseSimSlot(val: unknown, fallback = 0): number {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  if (n === 1 || n === 2) return n;
  return fallback;
}

export function maskApiKey(key?: string | null): string {
  if (!key || !key.trim()) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export function buildTextBeeSendUrl(deviceId: string): string {
  return `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`;
}

function parseSimList(rawDevice: Record<string, unknown>): TextBeeSimInfo[] {
  const simInfo = rawDevice?.simInfo as Record<string, unknown> | undefined;
  const simsRaw = Array.isArray(simInfo?.sims) ? simInfo.sims : [];
  return simsRaw.map((item, idx) => {
    const s = (item && typeof item === 'object') ? (item as Record<string, unknown>) : {};
    const slotIdx = typeof s.simSlotIndex === 'number' ? s.simSlotIndex + 1 : idx + 1;
    const carrier = String(s.carrierName || s.displayName || 'SIM');
    const displayName = String(s.displayName || s.carrierName || `SIM ${slotIdx}`);
    return {
      slot: slotIdx,
      subscriptionId: typeof s.subscriptionId === 'number' ? s.subscriptionId : null,
      carrier,
      displayName,
      serviceState: s.serviceState ? String(s.serviceState) : null,
      signalLevel: typeof s.signalLevel === 'number' ? s.signalLevel : null,
    };
  });
}

export async function getSmsGatewayConfig(): Promise<SmsGatewayConfig> {
  const { data: settingsData } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', 'sms_gateway_config')
    .maybeSingle();

  const raw = (settingsData?.value && typeof settingsData.value === 'object')
    ? (settingsData.value as Record<string, unknown>)
    : {};
  const envDeviceId = process.env.TEXTBEE_DEVICE_ID || '';
  const envApiKey = process.env.TEXTBEE_API_KEY || '';
  const deviceId = String(raw.deviceId || envDeviceId || '').trim();
  const apiKey = String(raw.apiKey || envApiKey || '').trim();
  const gatewayUrl = String(raw.gatewayUrl || (deviceId ? buildTextBeeSendUrl(deviceId) : '')).trim();

  const rawTriggers = (raw.triggers && typeof raw.triggers === 'object')
    ? (raw.triggers as Record<string, unknown>)
    : {};
  const triggers: SmsTriggersConfig = {
    onPawnCreate: rawTriggers.onPawnCreate !== false,
    onPawnApprove: rawTriggers.onPawnApprove !== false,
    onPawnReject: rawTriggers.onPawnReject === true,
    onPawnRedeem: rawTriggers.onPawnRedeem !== false,
    onInterestPayment: rawTriggers.onInterestPayment !== false,
    onForfeitureWarning: rawTriggers.onForfeitureWarning !== false,
  };

  const templates: SmsTemplatesConfig = {};
  const rawTemplates = (raw.templates && typeof raw.templates === 'object')
    ? (raw.templates as Record<string, unknown>)
    : {};
  for (const key of ['RECEIPT', 'APPROVED', 'REJECTED', 'INTEREST', 'REDEEM', 'REMINDER', 'FORFEITURE'] as SmsTemplateKey[]) {
    const val = rawTemplates[key];
    if (typeof val === 'string' && val.trim()) {
      templates[key] = val;
    }
  }

  const branches = (raw.branches && typeof raw.branches === 'object' && !Array.isArray(raw.branches))
    ? (raw.branches as Record<string, BranchSmsConfig>)
    : {};

  return {
    enabled: raw.enabled !== false,
    provider: 'TEXTBEE',
    email: String(raw.email || '').trim(),
    deviceId,
    apiKey,
    gatewayUrl,
    simSlot: parseSimSlot(raw.simSlot, 0),
    branches,
    triggers,
    templates,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

export function isAutoTriggerEnabled(config: SmsGatewayConfig, triggerKey?: SmsTriggerKey): boolean {
  if (!triggerKey) return true;
  return config?.triggers?.[triggerKey] ?? DEFAULT_SMS_TRIGGERS[triggerKey];
}

export function findBranchConfig(
  branches: Record<string, BranchSmsConfig>,
  branchId?: string | null
): { key: string; config: BranchSmsConfig } | null {
  if (!branchId || !branches) return null;
  const trimmed = String(branchId).trim();
  if (!trimmed || trimmed.toUpperCase() === 'GLOBAL') return null;

  if (branches[trimmed]) return { key: trimmed, config: branches[trimmed] };
  const normTarget = normalizeBranchId(trimmed);
  if (branches[normTarget]) return { key: normTarget, config: branches[normTarget] };

  const searchTerms = getBranchSearchTerms(normTarget).map((t) => t.toUpperCase());
  for (const [k, v] of Object.entries(branches)) {
    if (!v) continue;
    if (normalizeBranchId(k) === normTarget || searchTerms.includes(k.toUpperCase())) {
      return { key: k, config: v };
    }
  }
  return null;
}

export function resolveBranchSmsConfig(
  globalConfig: SmsGatewayConfig,
  branchId?: string | null,
  forceGlobal = false
) {
  const normBranch = !branchId || String(branchId).toUpperCase() === 'GLOBAL'
    ? 'HQ'
    : normalizeBranchId(branchId);

  const matched = forceGlobal ? null : findBranchConfig(globalConfig.branches, normBranch);
  const branchConfig = matched?.config || null;
  const hasCustomDevice = Boolean(branchConfig?.deviceId && branchConfig.deviceId.trim());
  const targetDeviceId = hasCustomDevice ? branchConfig!.deviceId!.trim() : globalConfig.deviceId;
  const targetApiKey = (branchConfig?.apiKey && branchConfig.apiKey.trim())
    ? branchConfig.apiKey.trim()
    : globalConfig.apiKey;
  const targetSimSlot = parseSimSlot(branchConfig?.simSlot, parseSimSlot(globalConfig.simSlot, 0));
  const targetEnabled = branchConfig
    ? (branchConfig.enabled !== false && globalConfig.enabled !== false)
    : globalConfig.enabled !== false;

  const targetUrl = targetDeviceId ? buildTextBeeSendUrl(targetDeviceId) : '';

  return {
    normBranch,
    branchConfig,
    hasCustomDevice,
    targetDeviceId,
    targetApiKey,
    targetSimSlot,
    targetEnabled,
    targetUrl,
  };
}

export function sanitizeSmsGatewayConfig(config: SmsGatewayConfig, isAdmin: boolean) {
  const sanitizedBranches: Record<string, unknown> = {};
  if (isAdmin && config.branches) {
    for (const [k, b] of Object.entries(config.branches)) {
      if (!b) continue;
      const keyStr = b.apiKey || '';
      sanitizedBranches[k] = {
        branchId: b.branchId || k,
        branchName: b.branchName || k,
        email: b.email || '',
        deviceId: b.deviceId || '',
        hasApiKey: Boolean(keyStr),
        maskedApiKey: maskApiKey(keyStr),
        gatewayUrl: b.deviceId ? buildTextBeeSendUrl(b.deviceId) : (b.gatewayUrl || ''),
        simSlot: parseSimSlot(b.simSlot, 0),
        enabled: b.enabled !== false,
        updatedAt: b.updatedAt || null,
      };
    }
  }

  return {
    enabled: config.enabled !== false,
    provider: 'TEXTBEE' as const,
    email: isAdmin ? (config.email || '') : '',
    deviceId: isAdmin ? config.deviceId : '',
    hasApiKey: Boolean(config.apiKey),
    maskedApiKey: isAdmin ? maskApiKey(config.apiKey) : '',
    gatewayUrl: isAdmin && config.deviceId ? buildTextBeeSendUrl(config.deviceId) : '',
    simSlot: parseSimSlot(config.simSlot, 0),
    branches: sanitizedBranches,
    configuredBranchCount: Object.values(config.branches || {}).filter((b) => Boolean(b?.deviceId)).length,
    triggers: config.triggers,
    templates: isAdmin ? config.templates : {},
    updatedAt: config.updatedAt || null,
  };
}

function formatTextBeeError(status: number, parsed: unknown, rawText: string): string {
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const msg = String(obj.message || obj.error || '');
    if (status === 429 && typeof obj.monthlyRemaining === 'number' && typeof obj.monthlyLimit === 'number') {
      const resetNote = obj.monthlyResetAt
        ? `, resets ${new Date(String(obj.monthlyResetAt)).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' })}`
        : '';
      return `TextBee limit reached (${obj.monthlyRemaining}/${obj.monthlyLimit} monthly left, daily left: ${obj.dailyRemaining ?? '?'}${resetNote}). ${msg}`.trim();
    }
    if (msg) return msg;
    return JSON.stringify(parsed);
  }
  return rawText;
}

export async function fetchTextBeeQuota(apiKey: string): Promise<TextBeeQuotaStatus | null> {
  if (!apiKey || !apiKey.trim()) return null;
  const headers = { 'x-api-key': apiKey.trim() };

  try {
    const [subRes, statsRes] = await Promise.allSettled([
      fetch('https://api.textbee.dev/api/v1/billing/current-subscription', {
        headers,
        signal: AbortSignal.timeout(5000),
      }),
      fetch('https://api.textbee.dev/api/v1/gateway/stats', {
        headers,
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (subRes.status !== 'fulfilled' || !subRes.value.ok) {
      return null;
    }

    const subJson = (await subRes.value.json()) as Record<string, unknown>;
    const plan = (subJson?.plan && typeof subJson.plan === 'object') ? (subJson.plan as Record<string, unknown>) : {};
    const usage = (subJson?.usage && typeof subJson.usage === 'object') ? (subJson.usage as Record<string, unknown>) : {};

    let statsData: Record<string, unknown> = {};
    if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
      try {
        const stJson = (await statsRes.value.json()) as Record<string, unknown>;
        if (stJson?.data && typeof stJson.data === 'object') {
          statsData = stJson.data as Record<string, unknown>;
        }
      } catch {}
    }

    const dailyLimit = Number(usage.dailyLimit ?? plan.dailyLimit ?? 50);
    const monthlyLimit = Number(usage.monthlyLimit ?? plan.monthlyLimit ?? 300);
    const dailyRemaining = Number(usage.dailyRemaining ?? dailyLimit);
    const monthlyRemaining = Number(usage.monthlyRemaining ?? monthlyLimit);

    return {
      planName: String(plan.name || 'free').toUpperCase(),
      isActive: subJson.isActive !== false,
      paymentHold: Boolean(usage.paymentHold),
      dailyLimit,
      dailyRemaining,
      processedSmsToday: Number(usage.processedSmsToday ?? Math.max(0, dailyLimit - dailyRemaining)),
      dailyUsagePercentage: Number(usage.dailyUsagePercentage ?? 0),
      monthlyLimit,
      monthlyRemaining,
      processedSmsLastMonth: Number(usage.processedSmsLastMonth ?? Math.max(0, monthlyLimit - monthlyRemaining)),
      monthlyUsagePercentage: Number(usage.monthlyUsagePercentage ?? 0),
      bulkSendLimit: Number(usage.bulkSendLimit ?? plan.bulkSendLimit ?? 50),
      deviceLimit: Number(usage.deviceLimit ?? plan.deviceLimit ?? 1),
      monthlyPeriodStart: usage.monthlyPeriodStart ? String(usage.monthlyPeriodStart) : null,
      monthlyResetAt: usage.monthlyResetAt ? String(usage.monthlyResetAt) : null,
      totalDeviceCount: typeof statsData.totalDeviceCount === 'number' ? statsData.totalDeviceCount : null,
      totalSentAllTime: typeof statsData.totalSentSMSCount === 'number' ? statsData.totalSentSMSCount : null,
      totalReceivedAllTime: typeof statsData.totalReceivedSMSCount === 'number' ? statsData.totalReceivedSMSCount : null,
    };
  } catch {
    return null;
  }
}

export async function discoverTextBeeDevices(apiKey: string): Promise<{
  ok: boolean;
  devices: TextBeeDiscoveredDevice[];
  quota: TextBeeQuotaStatus | null;
  account?: { name?: string; email?: string } | null;
  error?: string;
}> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, devices: [], quota: null, error: 'TextBee API Key is required.' };
  }

  try {
    const headers = { 'x-api-key': cleanKey };
    const [devRes, quota, whoRes] = await Promise.all([
      fetch('https://api.textbee.dev/api/v1/gateway/devices', {
        headers,
        signal: AbortSignal.timeout(7000),
      }),
      fetchTextBeeQuota(cleanKey),
      fetch('https://api.textbee.dev/api/v1/auth/who-am-i', {
        headers,
        signal: AbortSignal.timeout(5000),
      }).catch(() => null),
    ]);

    const rawText = await devRes.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {}

    if (!devRes.ok) {
      return {
        ok: false,
        devices: [],
        quota,
        error: formatTextBeeError(devRes.status, parsed, rawText) || `TextBee API returned HTTP ${devRes.status}`,
      };
    }

    const rawList = Array.isArray(parsed.data) ? parsed.data : [];
    const devices: TextBeeDiscoveredDevice[] = rawList
      .filter((d): d is Record<string, unknown> => Boolean(d && typeof d === 'object'))
      .map((d) => {
        const lastHeartbeat = d.lastHeartbeat ? String(d.lastHeartbeat) : null;
        const ageMinutes = lastHeartbeat
          ? Math.max(0, Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 60000))
          : null;
        const enabled = d.enabled !== false;
        const battery = (d.batteryInfo && typeof d.batteryInfo === 'object') ? (d.batteryInfo as Record<string, unknown>) : {};
        const network = (d.networkInfo && typeof d.networkInfo === 'object') ? (d.networkInfo as Record<string, unknown>) : {};

        return {
          id: String(d._id || d.id || ''),
          name: String(d.name || `${d.brand || ''} ${d.model || ''}`.trim() || 'TextBee Android'),
          brand: d.brand ? String(d.brand) : null,
          model: d.model ? String(d.model) : null,
          enabled,
          isDefault: Boolean(d.isDefault),
          osVersion: d.osVersion ? String(d.osVersion) : null,
          appVersion: d.appVersionName ? String(d.appVersionName) : null,
          lastHeartbeat,
          heartbeatAgeMinutes: ageMinutes,
          online: enabled && ageMinutes !== null && ageMinutes <= 35,
          batteryPercentage: typeof battery.percentage === 'number' ? battery.percentage : null,
          isCharging: typeof battery.isCharging === 'boolean' ? battery.isCharging : null,
          networkType: network.networkType ? String(network.networkType) : null,
          sentSMSCount: typeof d.sentSMSCount === 'number' ? d.sentSMSCount : null,
          sims: parseSimList(d),
        };
      })
      .filter((d) => Boolean(d.id));

    let account: { name?: string; email?: string } | null = null;
    if (whoRes && whoRes.ok) {
      try {
        const whoJson = (await whoRes.json()) as { data?: { name?: string; email?: string } };
        if (whoJson?.data) {
          account = { name: whoJson.data.name, email: whoJson.data.email };
        }
      } catch {}
    }

    return { ok: true, devices, quota, account };
  } catch (err: unknown) {
    return {
      ok: false,
      devices: [],
      quota: null,
      error: getErrMessage(err, 'Failed to connect to TextBee Cloud API'),
    };
  }
}

async function dispatchToTextBeeApi(params: {
  deviceId: string;
  apiKey: string;
  phone: string;
  message: string;
  simSlot?: number;
  dryRun?: boolean;
}) {
  const { deviceId, apiKey, phone, message, simSlot = 0, dryRun } = params;
  const endpoint = buildTextBeeSendUrl(deviceId);

  if (dryRun) {
    return {
      ok: true,
      transientFailure: false,
      httpStatus: 200,
      responseBody: { dryRun: true, message: 'Dry run simulation' },
      notice: 'Dry-run simulation OK',
      error: null as string | null,
    };
  }

  try {
    const payload: Record<string, unknown> = {
      recipients: [phone],
      message,
    };
    if (simSlot >= 1 && simSlot <= 2) {
      payload.simSlotIndex = simSlot - 1;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const rawText = await res.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {}

    if (res.ok) {
      return {
        ok: true,
        transientFailure: false,
        httpStatus: res.status,
        responseBody: parsed,
        notice: 'Dispatched via TextBee Android SIM Gateway.',
        error: null as string | null,
      };
    }

    const errMsg = formatTextBeeError(res.status, parsed, rawText);

    return {
      ok: false,
      transientFailure: res.status >= 500 || res.status === 429,
      httpStatus: res.status,
      responseBody: parsed,
      notice: `TextBee HTTP ${res.status}: ${errMsg.slice(0, 220)}`,
      error: errMsg.slice(0, 320),
    };
  } catch (err: unknown) {
    const msg = getErrMessage(err, 'Gateway unreachable');
    return {
      ok: false,
      transientFailure: true,
      httpStatus: null,
      responseBody: null,
      notice: `TextBee connection/timeout error: ${msg}`,
      error: msg,
    };
  }
}

export async function sendFreeSms(params: SendSmsParams): Promise<SendSmsResult> {
  const {
    phone,
    message,
    ticketNo,
    amount,
    type = 'RECEIPT',
    branchId = 'HQ',
    forceGlobal = false,
    triggerKey,
    skipTriggerCheck = false,
    dryRun = false,
  } = params;

  if (!phone || !message || !message.trim()) {
    return { success: false, status: 'FAILED', phone: phone || '', error: 'Phone number and message are required.' };
  }

  const normalizedPhone = normalizeSriLankaPhone(phone);
  if (!normalizedPhone.valid) {
    return {
      success: false,
      status: 'INVALID_PHONE',
      phone: phone.trim(),
      branchId: normalizeBranchId(branchId),
      notice: normalizedPhone.reason,
      error: normalizedPhone.reason,
    };
  }

  try {
    const globalConfig = await getSmsGatewayConfig();
    if (triggerKey && !skipTriggerCheck && !isAutoTriggerEnabled(globalConfig, triggerKey)) {
      return {
        success: false,
        status: 'SKIPPED',
        phone: normalizedPhone.e164,
        branchId: normalizeBranchId(branchId),
        notice: `Auto-SMS trigger '${triggerKey}' is disabled.`,
      };
    }

    const resolved = resolveBranchSmsConfig(globalConfig, branchId, forceGlobal);
    if (!resolved.targetEnabled) {
      return {
        success: false,
        status: 'DISABLED',
        phone: normalizedPhone.e164,
        branchId: resolved.normBranch,
        notice: `SMS Gateway is disabled for branch ${resolved.normBranch}.`,
        error: `SMS Gateway is disabled for branch ${resolved.normBranch}.`,
      };
    }

    if (!resolved.targetDeviceId || !resolved.targetApiKey) {
      const notice = `TextBee credentials not configured for branch ${resolved.normBranch}.`;
      const nowIso = new Date().toISOString();
      const { data: inserted } = await adminSupabase
        .from('sms_logs')
        .insert([{
          recipient_phone: normalizedPhone.e164,
          message_text: message,
          branch_id: resolved.normBranch,
          status: 'FAILED',
          gateway_response: {
            notice,
            error: notice,
            provider: 'TEXTBEE',
            ticket_no: ticketNo || null,
            amount: amount ?? null,
            type,
            attempts: 1,
            last_attempt_at: nowIso,
          },
          created_at: nowIso,
        }])
        .select('id')
        .maybeSingle();

      return {
        success: false,
        status: 'NOT_CONFIGURED',
        logId: inserted?.id || null,
        phone: normalizedPhone.e164,
        branchId: resolved.normBranch,
        notice,
        error: notice,
      };
    }

    const dispatchRes = await dispatchToTextBeeApi({
      deviceId: resolved.targetDeviceId,
      apiKey: resolved.targetApiKey,
      phone: normalizedPhone.e164,
      message,
      simSlot: resolved.targetSimSlot,
      dryRun,
    });

    const finalStatus: 'SENT' | 'QUEUED' | 'FAILED' = dispatchRes.ok
      ? 'SENT'
      : dispatchRes.transientFailure
      ? 'QUEUED'
      : 'FAILED';

    const scopeLabel = forceGlobal
      ? 'Master Global Gateway'
      : resolved.hasCustomDevice
      ? `Branch [${resolved.normBranch}] SIM`
      : `Master Gateway (via ${resolved.normBranch})`;

    const fullNotice = dispatchRes.ok
      ? `SMS sent via ${scopeLabel}.`
      : `${scopeLabel} - ${dispatchRes.notice}`;

    const nowIso = new Date().toISOString();
    const { data: insertedLog, error: logErr } = await adminSupabase
      .from('sms_logs')
      .insert([{
        recipient_phone: normalizedPhone.e164,
        message_text: message,
        branch_id: resolved.normBranch,
        status: finalStatus,
        gateway_response: {
          notice: fullNotice,
          error: dispatchRes.error,
          http_status: dispatchRes.httpStatus,
          provider: 'TEXTBEE',
          device_id_tail: resolved.targetDeviceId.slice(-4),
          used_branch_device: resolved.hasCustomDevice,
          force_global: Boolean(forceGlobal),
          sim_slot: resolved.targetSimSlot,
          ticket_no: ticketNo || null,
          amount: amount ?? null,
          type,
          attempts: 1,
          last_attempt_at: nowIso,
          dry_run: Boolean(dryRun),
        },
        created_at: nowIso,
      }])
      .select('id')
      .maybeSingle();

    if (logErr) {
      console.warn('sms_logs insert notice:', logErr.message);
    }

    return {
      success: dispatchRes.ok,
      status: finalStatus,
      logId: insertedLog?.id || null,
      phone: normalizedPhone.e164,
      branchId: resolved.normBranch,
      notice: fullNotice,
      error: dispatchRes.error || undefined,
      httpStatus: dispatchRes.httpStatus,
      usedBranchDevice: resolved.hasCustomDevice,
    };
  } catch (err: unknown) {
    console.warn('sendFreeSms exception:', err);
    return {
      success: false,
      status: 'FAILED',
      phone: normalizedPhone.e164 || phone,
      branchId: normalizeBranchId(branchId),
      error: getErrMessage(err, 'Failed to dispatch SMS'),
    };
  }
}

export async function retrySmsLogEntry(params: {
  logId: string;
  isAdmin: boolean;
  allowedBranch?: string | null;
  dryRun?: boolean;
}) {
  const { logId, isAdmin, allowedBranch, dryRun = false } = params;

  const { data: logRow, error: fetchErr } = await adminSupabase
    .from('sms_logs')
    .select('*')
    .eq('id', logId)
    .maybeSingle();

  if (fetchErr || !logRow) {
    return { success: false, status: 404, error: 'SMS log entry not found.' };
  }

  const normLogBranch = normalizeBranchId(logRow.branch_id || 'HQ');
  if (!isAdmin && allowedBranch) {
    const normCaller = normalizeBranchId(allowedBranch);
    if (normCaller && normCaller !== 'ALL' && normCaller !== 'HQ' && normLogBranch !== normCaller) {
      return { success: false, status: 403, error: 'Forbidden. Cannot retry SMS logs from another branch.' };
    }
  }

  if (logRow.status === 'SENT') {
    return { success: true, status: 200, alreadySent: true, message: 'This SMS was already delivered.' };
  }

  const normalizedPhone = normalizeSriLankaPhone(logRow.recipient_phone);
  if (!normalizedPhone.valid) {
    return { success: false, status: 400, error: normalizedPhone.reason || 'Invalid phone number on log.' };
  }

  const prevMeta: Record<string, unknown> = (logRow.gateway_response && typeof logRow.gateway_response === 'object')
    ? (logRow.gateway_response as Record<string, unknown>)
    : { legacy_notice: typeof logRow.gateway_response === 'string' ? logRow.gateway_response : '' };

  const globalConfig = await getSmsGatewayConfig();
  const forceGlobal = Boolean(prevMeta.force_global);
  const resolved = resolveBranchSmsConfig(globalConfig, normLogBranch, forceGlobal);

  if (!resolved.targetEnabled) {
    return { success: false, status: 400, error: `SMS Gateway is disabled for branch ${resolved.normBranch}.` };
  }
  if (!resolved.targetDeviceId || !resolved.targetApiKey) {
    return { success: false, status: 400, error: `TextBee credentials not configured for branch ${resolved.normBranch}.` };
  }

  const dispatchRes = await dispatchToTextBeeApi({
    deviceId: resolved.targetDeviceId,
    apiKey: resolved.targetApiKey,
    phone: normalizedPhone.e164,
    message: String(logRow.message_text || ''),
    simSlot: resolved.targetSimSlot,
    dryRun,
  });

  const nextStatus: 'SENT' | 'QUEUED' | 'FAILED' = dispatchRes.ok
    ? 'SENT'
    : dispatchRes.transientFailure
    ? 'QUEUED'
    : 'FAILED';

  const nowIso = new Date().toISOString();
  const prevAttempts = Number(prevMeta.attempts) || 1;
  const notice = dispatchRes.ok
    ? `Retry succeeded via ${resolved.hasCustomDevice ? `Branch [${resolved.normBranch}] SIM` : 'Master Gateway'}.`
    : `Retry failed - ${dispatchRes.notice}`;

  const updatedMeta = {
    ...prevMeta,
    notice,
    error: dispatchRes.error,
    http_status: dispatchRes.httpStatus,
    provider: 'TEXTBEE',
    device_id_tail: resolved.targetDeviceId.slice(-4),
    used_branch_device: resolved.hasCustomDevice,
    sim_slot: resolved.targetSimSlot,
    attempts: prevAttempts + 1,
    last_attempt_at: nowIso,
    retried_at: nowIso,
  };

  const { data: updatedRow, error: updErr } = await adminSupabase
    .from('sms_logs')
    .update({
      status: nextStatus,
      gateway_response: updatedMeta,
    })
    .eq('id', logId)
    .select('*')
    .single();

  if (updErr) {
    return { success: false, status: 500, error: updErr.message };
  }

  return {
    success: dispatchRes.ok,
    status: 200,
    smsStatus: nextStatus,
    notice,
    error: dispatchRes.error || undefined,
    log: formatSmsLogRow(updatedRow),
  };
}

export async function checkTextBeeDeviceHealth(
  branchId?: string | null,
  forceGlobal = false
): Promise<TextBeeHealthStatus> {
  const globalConfig = await getSmsGatewayConfig();
  const resolved = resolveBranchSmsConfig(globalConfig, branchId, forceGlobal);

  if (!resolved.targetDeviceId || !resolved.targetApiKey) {
    return {
      configured: false,
      enabled: resolved.targetEnabled,
      online: false,
      status: 'NOT_CONFIGURED',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      quota: null,
      error: 'Device ID or API Key is not configured.',
    };
  }

  if (!resolved.targetEnabled) {
    const quota = await fetchTextBeeQuota(resolved.targetApiKey);
    return {
      configured: true,
      enabled: false,
      online: false,
      status: 'DISABLED',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      deviceIdTail: resolved.targetDeviceId.slice(-4),
      quota,
      error: 'Gateway is paused/disabled in system settings.',
    };
  }

  try {
    const [res, quota] = await Promise.all([
      fetch(
        `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(resolved.targetDeviceId)}`,
        {
          headers: { 'x-api-key': resolved.targetApiKey },
          signal: AbortSignal.timeout(6000),
        }
      ),
      fetchTextBeeQuota(resolved.targetApiKey),
    ]);

    if (!res.ok) {
      return {
        configured: true,
        enabled: true,
        online: false,
        status: 'ERROR',
        branchId: resolved.normBranch,
        usedBranchDevice: resolved.hasCustomDevice,
        deviceIdTail: resolved.targetDeviceId.slice(-4),
        quota,
        error: `TextBee API returned HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const d = (json?.data && typeof json.data === 'object')
      ? (json.data as Record<string, unknown>)
      : (json || {});

    const lastHeartbeat = d.lastHeartbeat ? String(d.lastHeartbeat) : null;
    const heartbeatAgeMinutes = lastHeartbeat
      ? Math.max(0, Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 60000))
      : null;

    const deviceEnabled = d.enabled !== false;
    const heartbeatIntervalMin = Number(d.heartbeatIntervalMinutes) || 30;
    // Allow 2 heartbeat cycles + 5m grace so active devices aren't flagged STALE on normal jitter
    const staleThresholdMin = Math.max(45, heartbeatIntervalMin * 2 + 5);
    const isFresh = heartbeatAgeMinutes !== null && heartbeatAgeMinutes <= staleThresholdMin;
    const online = deviceEnabled && isFresh;

    const batteryInfo = (d.batteryInfo && typeof d.batteryInfo === 'object') ? (d.batteryInfo as Record<string, unknown>) : {};
    const networkInfo = (d.networkInfo && typeof d.networkInfo === 'object') ? (d.networkInfo as Record<string, unknown>) : {};
    const powerInfo = (d.powerInfo && typeof d.powerInfo === 'object') ? (d.powerInfo as Record<string, unknown>) : {};
    const appState = (d.appStateInfo && typeof d.appStateInfo === 'object') ? (d.appStateInfo as Record<string, unknown>) : {};

    const sims = parseSimList(d);
    const permissionsOk = (
      appState.hasSendSmsPermission !== false &&
      appState.hasPostNotificationsPermission !== false
    );

    return {
      configured: true,
      enabled: deviceEnabled,
      online,
      status: !deviceEnabled ? 'DISABLED' : isFresh ? 'ONLINE' : 'STALE',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      deviceIdTail: resolved.targetDeviceId.slice(-4),
      deviceName: d.name ? String(d.name) : null,
      brand: d.brand ? String(d.brand) : null,
      model: d.model ? String(d.model) : null,
      osVersion: d.osVersion ? String(d.osVersion) : null,
      appVersion: d.appVersionName ? String(d.appVersionName) : null,
      lastHeartbeat,
      heartbeatAgeMinutes,
      batteryPercentage: typeof batteryInfo.percentage === 'number' ? batteryInfo.percentage : null,
      isCharging: typeof batteryInfo.isCharging === 'boolean' ? batteryInfo.isCharging : null,
      networkType: networkInfo.networkType ? String(networkInfo.networkType) : null,
      sentSMSCount: typeof d.sentSMSCount === 'number' ? d.sentSMSCount : null,
      receivedSMSCount: typeof d.receivedSMSCount === 'number' ? d.receivedSMSCount : null,
      receiveSMSEnabled: typeof d.receiveSMSEnabled === 'boolean' ? d.receiveSMSEnabled : null,
      batteryOptimizationIgnored: typeof powerInfo.isIgnoringBatteryOptimizations === 'boolean'
        ? powerInfo.isIgnoringBatteryOptimizations
        : null,
      permissionsOk,
      sims,
      quota,
      error: null,
    };
  } catch (err: unknown) {
    return {
      configured: true,
      enabled: true,
      online: false,
      status: 'ERROR',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      deviceIdTail: resolved.targetDeviceId.slice(-4),
      quota: null,
      error: getErrMessage(err, 'Failed to reach TextBee Cloud API'),
    };
  }
}

export function formatSmsLogRow(row: Record<string, unknown>): FormattedSmsLogRow {
  const rawMeta = row?.gateway_response;
  const meta: Record<string, unknown> = (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta))
    ? (rawMeta as Record<string, unknown>)
    : {};
  const legacyString = typeof rawMeta === 'string' ? rawMeta : '';

  const phone = String(row?.recipient_phone || row?.phone || '');
  const message = String(row?.message_text || row?.message || '');
  const status = String(row?.status || 'QUEUED');
  const notice = String(
    meta.notice || meta.legacy_notice || legacyString || (status === 'SENT' ? 'Dispatched via TextBee' : 'Pending / Queued')
  );

  return {
    id: row?.id ? String(row.id) : undefined,
    branch_id: String(row?.branch_id || 'HQ'),
    phone,
    recipient_phone: phone,
    message,
    message_text: message,
    ticket_no: row?.ticket_no ? String(row.ticket_no) : (meta.ticket_no ? String(meta.ticket_no) : null),
    amount: row?.amount !== undefined && row?.amount !== null
      ? Number(row.amount)
      : (meta.amount !== undefined && meta.amount !== null ? Number(meta.amount) : null),
    type: String(row?.type || meta.type || 'RECEIPT'),
    status,
    notice,
    dispatch_notice: notice,
    error: meta.error ? String(meta.error) : null,
    http_status: typeof meta.http_status === 'number' ? meta.http_status : null,
    attempts: Number(meta.attempts) || 1,
    sim_slot: typeof meta.sim_slot === 'number' ? meta.sim_slot : null,
    used_branch_device: Boolean(meta.used_branch_device),
    device_id_tail: meta.device_id_tail ? String(meta.device_id_tail) : null,
    retried_at: meta.retried_at ? String(meta.retried_at) : null,
    created_at: row?.created_at ? String(row.created_at) : undefined,
  };
}

export async function resolvePawnCustomerContact(pawn: {
  phone?: string | null;
  client_phone?: string | null;
  client_name?: string | null;
  customer_name?: string | null;
  client_id?: string | null;
}): Promise<{ phone: string; name: string }> {
  let phone = String(pawn?.phone || pawn?.client_phone || '').trim();
  let name = String(pawn?.client_name || pawn?.customer_name || '').trim();

  if ((!phone || !name) && pawn?.client_id) {
    const { data: clientRow } = await adminSupabase
      .from('clients')
      .select('phone, first_name, last_name')
      .eq('id', pawn.client_id)
      .maybeSingle();

    if (clientRow) {
      if (!phone && clientRow.phone) phone = String(clientRow.phone).trim();
      if (!name) name = `${clientRow.first_name || ''} ${clientRow.last_name || ''}`.trim();
    }
  }

  return {
    phone,
    name: name || 'Valued Customer',
  };
}
