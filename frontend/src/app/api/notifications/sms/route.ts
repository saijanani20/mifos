import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { getBranchName, getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';
import {
  checkTextBeeDeviceHealth,
  formatSmsLogRow,
  getSmsGatewayConfig,
  getSriLankaDateString,
  normalizeSriLankaPhone,
  renderSmsTemplate,
  retrySmsLogEntry,
  sanitizeSmsGatewayConfig,
  sendFreeSms,
} from '@/lib/sms';
import { SmsTemplateKey } from '@/lib/sms-templates';

export const dynamic = 'force-dynamic';

function getColomboYmd(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function getErrMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Internal Server Error';
}

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot dispatch SMS alerts.' }, { status: 403 });
    }

    const body = await req.json();
    const isAdmin = session.role === 'ADMIN';
    const userBranch = normalizeBranchId(session.branchId || 'HQ');
    const isHead = isAdmin || userBranch === 'HQ';

    // 1. Single Failed/Queued Log Retry
    if (body.action === 'RETRY') {
      const logId = String(body.logId || '').trim();
      if (!logId) {
        return NextResponse.json({ error: 'Missing logId for SMS retry.' }, { status: 400 });
      }
      const res = await retrySmsLogEntry({
        logId,
        isAdmin: isHead,
        allowedBranch: isHead ? null : userBranch,
      });

      const resObj = res as { success: boolean; status?: number; smsStatus?: string; notice?: string; error?: string };
      await recordAuditLog(session, {
        action: 'SMS_RETRY',
        resource: `sms_log:${logId}`,
        branchId: userBranch,
        status: resObj.success ? 'SUCCESS' : 'FAILED',
        details: { logId, success: resObj.success, smsStatus: resObj.smsStatus, notice: resObj.notice, error: resObj.error },
        request: req,
      });

      const httpCode = resObj.status || (resObj.success ? 200 : 400);
      return NextResponse.json(res, { status: httpCode });
    }

    // 2. Batch Retry Pending/Failed Logs (bounded for serverless safety)
    if (body.action === 'RETRY_PENDING') {
      const reqBranch = body.branchId ? String(body.branchId).trim() : 'ALL';
      const effectiveBranch = !isHead
        ? userBranch
        : reqBranch && reqBranch.toUpperCase() !== 'ALL' && reqBranch.toUpperCase() !== 'GLOBAL'
        ? normalizeBranchId(reqBranch)
        : null;

      // Support up to 30 days lookback (720h), default 168h (7 days); capped at 10 per click to stay well under serverless timeout
      const lookbackHours = body.lookbackHours === 0 || body.lookbackHours === 'ALL'
        ? null
        : Math.min(Math.max(Number(body.lookbackHours) || 168, 1), 720);
      const maxBatch = Math.min(Math.max(Number(body.limit) || 10, 1), 10);

      let q = adminSupabase
        .from('sms_logs')
        .select('id, branch_id')
        .in('status', ['QUEUED', 'FAILED'])
        .order('created_at', { ascending: false })
        .limit(maxBatch);

      if (lookbackHours !== null) {
        const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
        q = q.gte('created_at', sinceIso);
      }

      if (effectiveBranch) {
        q = q.in('branch_id', getBranchSearchTerms(effectiveBranch));
      }

      const { data: pendingRows, error: qErr } = await q;
      if (qErr) throw qErr;

      let sentCount = 0;
      let failedCount = 0;
      const results: Array<{
        id: string;
        branch_id: string | null;
        success: boolean;
        smsStatus?: string;
        error?: string;
      }> = [];

      for (const row of pendingRows || []) {
        const retryRes = await retrySmsLogEntry({
          logId: String(row.id),
          isAdmin: isHead,
          allowedBranch: isHead ? null : userBranch,
        });
        const retryObj = retryRes as { success: boolean; smsStatus?: string; error?: string };
        if (retryObj.success) sentCount++;
        else failedCount++;
        results.push({
          id: String(row.id),
          branch_id: row.branch_id ? String(row.branch_id) : null,
          success: retryObj.success,
          smsStatus: retryObj.smsStatus,
          error: retryObj.error,
        });
      }

      await recordAuditLog(session, {
        action: 'SMS_BATCH_RETRY',
        resource: `branch:${effectiveBranch || 'ALL'}`,
        branchId: effectiveBranch || userBranch,
        details: { attempted: (pendingRows || []).length, sentCount, failedCount, lookbackHours: lookbackHours ?? 'ALL' },
        request: req,
      });

      return NextResponse.json({
        success: sentCount > 0 || (pendingRows || []).length === 0,
        attempted: (pendingRows || []).length,
        sentCount,
        failedCount,
        results,
      });
    }

    // 3. Bulk Reminder / Alert Dispatch
    if (body.mode === 'BULK') {
      const recipients = Array.isArray(body.recipients) ? body.recipients : [];
      if (recipients.length === 0) {
        return NextResponse.json({ error: 'At least one recipient is required for bulk SMS.' }, { status: 400 });
      }
      if (recipients.length > 50) {
        return NextResponse.json({ error: 'Bulk SMS is limited to 50 recipients per batch.' }, { status: 400 });
      }

      const config = await getSmsGatewayConfig();
      const templateKey: SmsTemplateKey = (body.templateKey || 'REMINDER') as SmsTemplateKey;
      const customTemplate = typeof body.customMessage === 'string' && body.customMessage.trim()
        ? body.customMessage.trim()
        : config.templates?.[templateKey];

      let sentCount = 0;
      let queuedCount = 0;
      let failedCount = 0;
      let invalidCount = 0;
      const results: Array<{
        phone: string;
        ticketNo: string | null;
        status: string;
        success: boolean;
        notice?: string;
        error?: string;
      }> = [];

      const todaySl = getSriLankaDateString();
      for (const rec of recipients) {
        const rawBranch = rec.branchId || body.branchId || userBranch;
        const targetBranch = !isHead ? userBranch : normalizeBranchId(String(rawBranch || userBranch));
        if (!isHead && normalizeBranchId(String(rawBranch || userBranch)) !== userBranch) {
          failedCount++;
          results.push({ phone: String(rec.phone || ''), ticketNo: null, status: 'FORBIDDEN', success: false, error: 'Cross-branch bulk SMS blocked.' });
          continue;
        }

        const branchLabel = getBranchName(targetBranch);
        const msgText = (typeof rec.message === 'string' && rec.message.trim())
          ? rec.message.trim()
          : renderSmsTemplate(
              templateKey,
              {
                customer_name: rec.customerName || 'Valued Customer',
                ticket_no: rec.ticketNo || 'N/A',
                amount: (Number(rec.amount) || 0).toLocaleString(),
                interest_amount: (Number(rec.interestAmount || rec.amount) || 0).toLocaleString(),
                date: todaySl,
                branch_name: branchLabel,
                branch_tag: branchLabel ? ` [${branchLabel}]` : '',
              },
              customTemplate
            );

        const res = await sendFreeSms({
          phone: String(rec.phone || ''),
          message: msgText,
          ticketNo: rec.ticketNo ? String(rec.ticketNo) : undefined,
          amount: rec.amount ? Number(rec.amount) : undefined,
          type: body.type || 'REMINDER',
          branchId: targetBranch,
          forceGlobal: Boolean(body.forceGlobal && isHead),
          skipTriggerCheck: true,
        });

        if (res.status === 'SENT') sentCount++;
        else if (res.status === 'QUEUED') queuedCount++;
        else if (res.status === 'INVALID_PHONE') invalidCount++;
        else failedCount++;

        results.push({
          phone: res.phone,
          ticketNo: rec.ticketNo ? String(rec.ticketNo) : null,
          status: res.status,
          success: res.success,
          notice: res.notice,
          error: res.error,
        });
      }

      await recordAuditLog(session, {
        action: 'SMS_BULK_DISPATCH',
        resource: `bulk:${recipients.length}`,
        branchId: userBranch,
        status: sentCount > 0 ? 'SUCCESS' : queuedCount > 0 ? 'WARNING' : 'FAILED',
        details: { total: recipients.length, sentCount, queuedCount, failedCount, invalidCount },
        request: req,
      });

      return NextResponse.json({
        success: sentCount > 0 || queuedCount > 0,
        mode: 'BULK',
        total: recipients.length,
        sentCount,
        queuedCount,
        failedCount,
        invalidCount,
        results,
      });
    }

    // 4. Single / Manual / Test SMS Dispatch
    const {
      phone,
      message,
      ticketNo,
      amount,
      type,
      branchId,
      forceGlobal,
      templateKey,
      useSavedTemplate,
      templateVars,
    } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Phone number and message are required' }, { status: 400 });
    }

    const normPhone = normalizeSriLankaPhone(phone);
    if (!normPhone.valid) {
      return NextResponse.json({ error: normPhone.reason || 'Invalid phone number format.' }, { status: 400 });
    }

    const reqBranchRaw = branchId ? String(branchId).trim() : '';
    const isGlobalRequested = reqBranchRaw.toUpperCase() === 'GLOBAL' || Boolean(forceGlobal);

    if (!isHead && reqBranchRaw && isGlobalRequested) {
      return NextResponse.json({ error: 'Forbidden. Only Head Office / Admins can test Master Global Gateway.' }, { status: 403 });
    }
    if (!isHead && reqBranchRaw && normalizeBranchId(reqBranchRaw) !== userBranch) {
      return NextResponse.json({ error: `Forbidden. You can only dispatch SMS from branch (${userBranch}).` }, { status: 403 });
    }

    const effectiveBranch = isHead
      ? (reqBranchRaw && reqBranchRaw.toUpperCase() !== 'GLOBAL' ? normalizeBranchId(reqBranchRaw) : userBranch)
      : userBranch;

    let finalMessage = typeof message === 'string' ? message.trim() : '';
    if (templateKey && (useSavedTemplate || !finalMessage)) {
      const cfg = await getSmsGatewayConfig();
      const tKey = String(templateKey) as SmsTemplateKey;
      const customTmpl = cfg.templates?.[tKey];
      if (customTmpl || !finalMessage) {
        const branchLabel = getBranchName(effectiveBranch);
        const rawVars = (templateVars && typeof templateVars === 'object')
          ? (templateVars as Record<string, string | number | undefined>)
          : {};
        finalMessage = renderSmsTemplate(
          tKey,
          {
            customer_name: rawVars.customer_name || 'Valued Customer',
            ticket_no: rawVars.ticket_no || ticketNo || 'N/A',
            amount: rawVars.amount ?? (Number(amount) || 0).toLocaleString(),
            date: rawVars.date || getSriLankaDateString(),
            branch_name: rawVars.branch_name || branchLabel,
            branch_tag: branchLabel ? ` [${branchLabel}]` : '',
            ...rawVars,
          },
          customTmpl
        );
      }
    }

    if (!finalMessage) {
      return NextResponse.json({ error: 'Phone number and message are required' }, { status: 400 });
    }

    const result = await sendFreeSms({
      phone: normPhone.e164,
      message: finalMessage,
      ticketNo,
      amount,
      type: type || 'RECEIPT',
      branchId: effectiveBranch,
      forceGlobal: isHead && isGlobalRequested,
      skipTriggerCheck: true,
    });

    await recordAuditLog(session, {
      action: 'SMS_DISPATCH',
      resource: `sms:${result.phone || phone}`,
      branchId: result.branchId || effectiveBranch,
      status: result.success ? 'SUCCESS' : result.status === 'QUEUED' ? 'WARNING' : 'FAILED',
      details: {
        phone: result.phone || phone,
        ticketNo,
        amount,
        type: type || 'RECEIPT',
        status: result.status,
        notice: result.notice,
      },
      request: req,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Error in /api/notifications/sms POST:', err);
    return NextResponse.json({ error: getErrMessage(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const isAdmin = session.role === 'ADMIN';
    const userBranch = normalizeBranchId(session.branchId || 'HQ');
    const isHead = isAdmin || userBranch === 'HQ';

    // Live TextBee device health & quota check
    if (searchParams.get('action') === 'health') {
      if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
        return NextResponse.json({ error: 'Forbidden. Only Admins or Branch Managers can probe gateway health.' }, { status: 403 });
      }
      const reqBranch = searchParams.get('branchId') || '';
      const isGlobal = reqBranch.toUpperCase() === 'GLOBAL';
      if (!isHead && reqBranch && !isGlobal && normalizeBranchId(reqBranch) !== userBranch) {
        return NextResponse.json({ error: 'Forbidden. Cross-branch health probe blocked.' }, { status: 403 });
      }
      const targetBranch = isHead ? (isGlobal ? 'HQ' : reqBranch || 'HQ') : userBranch;
      const health = await checkTextBeeDeviceHealth(targetBranch, isHead && isGlobal);
      return NextResponse.json({ success: true, health, quota: health.quota || null });
    }

    const branchParam = searchParams.get('branch') || 'ALL';
    const statusParam = (searchParams.get('status') || 'ALL').toUpperCase();
    const rawSearch = (searchParams.get('search') || '').trim();
    const safeSearch = rawSearch.replace(/[,()\\]/g, ' ').trim();
    const limitParam = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 10), 250);

    let logsQuery = adminSupabase
      .from('sms_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limitParam);

    if (!isHead) {
      logsQuery = logsQuery.in('branch_id', getBranchSearchTerms(userBranch));
    } else if (branchParam && branchParam !== 'ALL' && branchParam.toUpperCase() !== 'GLOBAL') {
      logsQuery = logsQuery.in('branch_id', getBranchSearchTerms(branchParam));
    }

    if (statusParam && statusParam !== 'ALL') {
      logsQuery = logsQuery.eq('status', statusParam);
    }

    if (safeSearch) {
      const q = `%${safeSearch}%`;
      logsQuery = logsQuery.or(`recipient_phone.ilike.${q},message_text.ilike.${q}`);
    }

    const { data: logsRaw, error: logsErr } = await logsQuery;
    if (logsErr) {
      console.warn('sms_logs query warning:', logsErr.message);
    }

    let statsQuery = adminSupabase
      .from('sms_logs')
      .select('status, created_at, branch_id')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!isHead) {
      statsQuery = statsQuery.in('branch_id', getBranchSearchTerms(userBranch));
    } else if (branchParam && branchParam !== 'ALL' && branchParam.toUpperCase() !== 'GLOBAL') {
      statsQuery = statsQuery.in('branch_id', getBranchSearchTerms(branchParam));
    }

    const { data: statsRows } = await statsQuery;
    const todayPrefix = getColomboYmd();
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stats = {
      total: (statsRows || []).length,
      sent: 0,
      queued: 0,
      failed: 0,
      todaySent: 0,
      retryable7d: 0,
    };

    for (const r of statsRows || []) {
      const st = String(r.status || '').toUpperCase();
      const createdMs = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
      if (st === 'SENT') {
        stats.sent++;
        if (r.created_at && getColomboYmd(new Date(String(r.created_at))) === todayPrefix) {
          stats.todaySent++;
        }
      } else if (st === 'QUEUED') {
        stats.queued++;
        if (createdMs >= sevenDaysAgoMs) stats.retryable7d++;
      } else if (st === 'FAILED') {
        stats.failed++;
        if (createdMs >= sevenDaysAgoMs) stats.retryable7d++;
      }
    }

    const config = await getSmsGatewayConfig();
    const safeConfig = sanitizeSmsGatewayConfig(config, isAdmin);

    let branchQuery = adminSupabase.from('branches').select('*').order('name', { ascending: true });
    if (!isHead) {
      branchQuery = branchQuery.in('id', getBranchSearchTerms(userBranch));
    }
    const { data: branchesData } = await branchQuery;

    return NextResponse.json({
      logs: (logsRaw || []).map((row) => formatSmsLogRow(row as Record<string, unknown>)),
      stats,
      isAdmin,
      isHead,
      userBranchId: userBranch,
      branches: branchesData || [{ id: 'HQ', name: 'Head Office' }],
      config: safeConfig,
    });
  } catch (err: unknown) {
    console.error('Error in /api/notifications/sms GET:', err);
    return NextResponse.json({
      logs: [],
      stats: { total: 0, sent: 0, queued: 0, failed: 0, todaySent: 0, retryable7d: 0 },
      config: {},
      branches: [],
      isAdmin: false,
    });
  }
}
