import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { normalizeBranchId } from '@/lib/branch-mapping';
import {
  BranchSmsConfig,
  buildTextBeeSendUrl,
  discoverTextBeeDevices,
  findBranchConfig,
  getSmsGatewayConfig,
  parseSimSlot,
  sanitizeSmsGatewayConfig,
  SmsGatewayConfig,
} from '@/lib/sms';
import { DEFAULT_SMS_TEMPLATES, SmsTemplateKey, SmsTriggerKey } from '@/lib/sms-templates';

export const dynamic = 'force-dynamic';

function shouldKeepExistingKey(incomingKey?: string | null, clearApiKey?: boolean): boolean {
  if (clearApiKey) return false;
  if (!incomingKey || !String(incomingKey).trim()) return true;
  const trimmed = String(incomingKey).trim();
  return trimmed.startsWith('••••') || trimmed === '***REDACTED***';
}

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Only Admins can modify SMS Gateway settings.' }, { status: 403 });
    }

    const body = await req.json();
    const {
      action,
      branchId,
      branchName,
      email,
      deviceId,
      apiKey,
      simSlot,
      enabled,
      clearApiKey,
      triggers,
      templates,
    } = body;

    const existingConfig = await getSmsGatewayConfig();

    // Read-only TextBee device auto-discovery using provided or stored API Key
    if (action === 'DISCOVER_DEVICES') {
      const targetBranch = branchId && String(branchId).toUpperCase() !== 'GLOBAL'
        ? normalizeBranchId(String(branchId))
        : 'GLOBAL';
      const branchExisting = targetBranch !== 'GLOBAL'
        ? findBranchConfig(existingConfig.branches || {}, targetBranch)?.config
        : null;

      const resolvedKey = shouldKeepExistingKey(apiKey, false)
        ? (branchExisting?.apiKey || existingConfig.apiKey || '')
        : String(apiKey || '').trim();

      if (!resolvedKey) {
        return NextResponse.json({ error: 'Paste your TextBee API Key first to detect connected devices.' }, { status: 400 });
      }

      const disc = await discoverTextBeeDevices(resolvedKey);
      if (!disc.ok) {
        return NextResponse.json({ error: disc.error || 'Could not detect TextBee devices.', quota: disc.quota }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        devices: disc.devices,
        quota: disc.quota,
        account: disc.account,
      });
    }

    const updatedBranches: Record<string, BranchSmsConfig> = { ...(existingConfig.branches || {}) };
    const nowIso = new Date().toISOString();

    const nextConfig: SmsGatewayConfig = {
      ...existingConfig,
      provider: 'TEXTBEE',
      branches: updatedBranches,
      updatedAt: nowIso,
    };

    if (action === 'TOGGLE_ENABLED') {
      if (branchId && String(branchId).toUpperCase() !== 'GLOBAL') {
        const normBranch = normalizeBranchId(String(branchId));
        const matched = findBranchConfig(updatedBranches, normBranch);
        if (matched) {
          updatedBranches[matched.key] = {
            ...matched.config,
            enabled: Boolean(enabled),
            updatedAt: nowIso,
          };
          nextConfig.branches = updatedBranches;
        } else {
          nextConfig.enabled = Boolean(enabled);
        }
      } else {
        nextConfig.enabled = Boolean(enabled);
      }
    } else if (action === 'REMOVE_BRANCH' && branchId && String(branchId).toUpperCase() !== 'GLOBAL') {
      const normBranch = normalizeBranchId(String(branchId));
      const matched = findBranchConfig(updatedBranches, normBranch);
      if (matched) {
        delete updatedBranches[matched.key];
      }
      delete updatedBranches[normBranch];
      nextConfig.branches = updatedBranches;
    } else if (action === 'SAVE_TRIGGERS' || (triggers && !branchId && deviceId === undefined)) {
      const incoming = (triggers && typeof triggers === 'object') ? triggers : {};
      const updatedTriggers = { ...existingConfig.triggers };
      for (const k of Object.keys(existingConfig.triggers) as SmsTriggerKey[]) {
        if (typeof incoming[k] === 'boolean') {
          updatedTriggers[k] = incoming[k];
        }
      }
      nextConfig.triggers = updatedTriggers;
    } else if (action === 'SAVE_TEMPLATES' || (templates && !branchId && deviceId === undefined)) {
      const incoming = (templates && typeof templates === 'object') ? templates : {};
      const updatedTemplates = { ...existingConfig.templates };
      for (const k of Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplateKey[]) {
        if (k in incoming) {
          const val = typeof incoming[k] === 'string' ? incoming[k].trim() : '';
          if (!val || val === DEFAULT_SMS_TEMPLATES[k].trim()) {
            delete updatedTemplates[k];
          } else {
            updatedTemplates[k] = val;
          }
        }
      }
      nextConfig.templates = updatedTemplates;
    } else if (branchId && String(branchId).toUpperCase() !== 'GLOBAL') {
      const normBranch = normalizeBranchId(String(branchId));
      const matched = findBranchConfig(updatedBranches, normBranch);
      const prevBranch = matched?.config;
      if (matched && matched.key !== normBranch) {
        delete updatedBranches[matched.key];
      }

      const finalDeviceId = deviceId !== undefined ? String(deviceId).trim() : String(prevBranch?.deviceId || '').trim();
      const finalApiKey = shouldKeepExistingKey(apiKey, clearApiKey)
        ? String(prevBranch?.apiKey || '')
        : String(apiKey || '').trim();

      updatedBranches[normBranch] = {
        branchId: normBranch,
        branchName: branchName || prevBranch?.branchName || normBranch,
        email: email !== undefined ? String(email).trim() : (prevBranch?.email || ''),
        deviceId: finalDeviceId,
        apiKey: finalApiKey,
        gatewayUrl: finalDeviceId ? buildTextBeeSendUrl(finalDeviceId) : '',
        simSlot: parseSimSlot(simSlot, parseSimSlot(prevBranch?.simSlot, 0)),
        enabled: enabled !== undefined ? enabled !== false : (prevBranch?.enabled !== false),
        updatedAt: nowIso,
      };
      nextConfig.branches = updatedBranches;
    } else {
      const finalDeviceId = deviceId !== undefined ? String(deviceId).trim() : existingConfig.deviceId;
      const finalApiKey = shouldKeepExistingKey(apiKey, clearApiKey)
        ? existingConfig.apiKey
        : String(apiKey || '').trim();

      nextConfig.email = email !== undefined ? String(email).trim() : existingConfig.email;
      nextConfig.deviceId = finalDeviceId;
      nextConfig.apiKey = finalApiKey;
      nextConfig.gatewayUrl = finalDeviceId ? buildTextBeeSendUrl(finalDeviceId) : '';
      nextConfig.simSlot = parseSimSlot(simSlot, parseSimSlot(existingConfig.simSlot, 0));
      nextConfig.enabled = enabled !== undefined ? enabled !== false : existingConfig.enabled;
    }

    if (triggers && typeof triggers === 'object') {
      for (const k of Object.keys(nextConfig.triggers) as SmsTriggerKey[]) {
        if (typeof triggers[k] === 'boolean') {
          nextConfig.triggers[k] = triggers[k];
        }
      }
    }
    if (templates && typeof templates === 'object') {
      for (const k of Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplateKey[]) {
        if (k in templates) {
          const val = typeof templates[k] === 'string' ? templates[k].trim() : '';
          if (!val || val === DEFAULT_SMS_TEMPLATES[k].trim()) {
            delete nextConfig.templates[k];
          } else {
            nextConfig.templates[k] = val;
          }
        }
      }
    }

    const { error } = await adminSupabase
      .from('system_settings')
      .upsert(
        {
          key: 'sms_gateway_config',
          value: nextConfig,
          description: 'TextBee SMS gateway config, triggers, and templates',
          updated_at: nowIso,
          updated_by: session.user?.email || session.user?.id || 'ADMIN',
        },
        { onConflict: 'key' }
      );

    if (error) {
      throw error;
    }

    const safeConfig = sanitizeSmsGatewayConfig(nextConfig, true);

    await recordAuditLog(session, {
      action: 'UPDATE_SMS_GATEWAY_CONFIG',
      resource: 'system_settings:sms_gateway_config',
      branchId: branchId && String(branchId).toUpperCase() !== 'GLOBAL' ? normalizeBranchId(String(branchId)) : 'HQ',
      details: {
        action: action || 'SAVE_GATEWAY',
        branchId: branchId || 'GLOBAL',
        config: safeConfig,
      },
      request: req,
    });

    return NextResponse.json({ success: true, config: safeConfig });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('Error in /api/settings/sms-gateway:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
