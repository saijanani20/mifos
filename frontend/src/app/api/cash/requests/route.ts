import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase, validateFinancialActionAuth } from '@/lib/auth-server';
import { generateCashReference } from '@/lib/cash-management';
import { recordAuditLog } from '@/lib/audit-logger';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchFilter = searchParams.get('branch');
    const statusFilter = searchParams.get('status');

    let query = adminSupabase.from('cash_requests').select('*').order('created_at', { ascending: false });

    // Tellers are restricted to viewing their own branch's requests
    if (session.role === 'TELLER') {
      query = query.eq('requesting_branch_id', session.trustedBranchId);
    } else if (branchFilter && branchFilter !== 'ALL') {
      query = query.eq('requesting_branch_id', normalizeBranchId(branchFilter));
    }

    if (statusFilter && statusFilter !== 'ALL') {
      query = query.eq('status', statusFilter);
    }

    const { data: requests, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(requests || []);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { requestingBranchId, requestedAmount, purpose, requiredDate, notes } = body;

    const effectiveBranch = session.role === 'ADMIN' ? normalizeBranchId(requestingBranchId || 'HQ') : session.trustedBranchId;

    const authCheck = validateFinancialActionAuth(session, effectiveBranch, ['ADMIN', 'MANAGER', 'TELLER']);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 403 });
    }

    const amount = Number(requestedAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Requested amount must be a positive number greater than 0.' }, { status: 400 });
    }

    if (!purpose?.trim()) {
      return NextResponse.json({ error: 'Purpose of cash requisition is required.' }, { status: 400 });
    }

    if (!requiredDate) {
      return NextResponse.json({ error: 'Required date is required.' }, { status: 400 });
    }

    // Capture current snapshot of branch cash from daily_ledgers
    let currentCash = 0;
    try {
      const { data: latestLedger } = await adminSupabase
        .from('daily_ledgers')
        .select('closing_balance')
        .eq('branch_id', effectiveBranch)
        .order('ledger_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestLedger) {
        currentCash = Number(latestLedger.closing_balance || 0);
      }
    } catch {}

    const requestRef = generateCashReference('REQ');

    // Insert Cash Request (Record 1: Immutable Requisition)
    const { data: cashReq, error: insertErr } = await adminSupabase
      .from('cash_requests')
      .insert([{
        request_ref: requestRef,
        requesting_branch_id: effectiveBranch,
        requested_by_user_id: session.user.id,
        requested_by_email: session.user.email || 'teller@mifos.lk',
        current_branch_cash: currentCash,
        requested_amount: amount,
        purpose: purpose.trim(),
        required_date: requiredDate,
        status: 'SUBMITTED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    await recordAuditLog(session, {
      action: 'CASH_REQUEST_SUBMITTED',
      resource: requestRef,
      branchId: effectiveBranch,
      details: {
        requestRef,
        requestedAmount: amount,
        purpose,
        currentCash,
        requiredDate
      }
    });

    return NextResponse.json({ success: true, request: cashReq }, { status: 201 });
  } catch (err: any) {
    console.error('Cash request creation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
