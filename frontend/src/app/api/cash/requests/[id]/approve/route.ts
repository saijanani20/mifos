import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { generateCashReference } from '@/lib/cash-management';
import { recordAuditLog } from '@/lib/audit-logger';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check: Only ADMIN and MANAGER can approve cash requests
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({ error: `Forbidden. Role '${session.role}' is not authorized to approve cash requests.` }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { approvedAmount, sourceType = 'BRANCH', sourceBranchId = 'HQ', sourceBankId } = body;

    // 1. Fetch Cash Request
    const { data: cashReq, error: fetchErr } = await adminSupabase
      .from('cash_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !cashReq) {
      return NextResponse.json({ error: 'Cash request not found.' }, { status: 404 });
    }

    if (cashReq.status !== 'SUBMITTED') {
      return NextResponse.json({ error: `Cannot approve request with current status '${cashReq.status}'.` }, { status: 400 });
    }

    // 2. Strict Maker-Checker Control: Requesters CANNOT approve their own requests
    if (cashReq.requested_by_user_id === session.user.id) {
      return NextResponse.json({
        error: 'Four-Eyes Maker-Checker Policy Violation: You cannot approve a cash request that you submitted yourself.'
      }, { status: 403 });
    }

    const finalApprovedAmount = Math.max(0, Number(approvedAmount || cashReq.requested_amount));
    if (finalApprovedAmount <= 0) {
      return NextResponse.json({ error: 'Approved amount must be greater than 0.' }, { status: 400 });
    }

    const normSourceBranch = normalizeBranchId(sourceBranchId);
    if (normSourceBranch === cashReq.requesting_branch_id) {
      return NextResponse.json({ error: 'Source branch and requesting destination branch cannot be the same.' }, { status: 400 });
    }

    const approvalTime = new Date().toISOString();

    // 3. Update Cash Request to APPROVED
    const { data: updatedReq, error: updateErr } = await adminSupabase
      .from('cash_requests')
      .update({
        status: 'APPROVED',
        approved_amount: finalApprovedAmount,
        approved_by_user_id: session.user.id,
        approved_by_email: session.user.email || 'manager@mifos.lk',
        approved_at: approvalTime,
        assigned_source_type: sourceType,
        assigned_source_branch_id: sourceType === 'BRANCH' ? normSourceBranch : null,
        assigned_source_bank_id: sourceType === 'BANK' ? sourceBankId : null,
        updated_at: approvalTime
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 4. Instantiate Linked Cash Transfer in ASSIGNED status
    const transferRef = generateCashReference('TRF');
    const { data: transfer, error: transferErr } = await adminSupabase
      .from('cash_transfers')
      .insert([{
        transfer_ref: transferRef,
        request_id: cashReq.id,
        source_branch_id: normSourceBranch,
        destination_branch_id: cashReq.requesting_branch_id,
        source_bank_id: sourceType === 'BANK' ? sourceBankId : null,
        amount: finalApprovedAmount,
        status: 'ASSIGNED',
        created_at: approvalTime,
        updated_at: approvalTime
      }])
      .select()
      .single();

    if (transferErr) {
      return NextResponse.json({ error: 'Failed to create transfer record: ' + transferErr.message }, { status: 500 });
    }

    await recordAuditLog(session, {
      action: 'CASH_REQUEST_APPROVED',
      resource: cashReq.request_ref,
      branchId: cashReq.requesting_branch_id,
      details: {
        requestRef: cashReq.request_ref,
        transferRef,
        approvedAmount: finalApprovedAmount,
        sourceBranch: normSourceBranch,
        destinationBranch: cashReq.requesting_branch_id,
        approverEmail: session.user.email
      }
    });

    return NextResponse.json({
      success: true,
      request: updatedReq,
      transfer
    });

  } catch (err: any) {
    console.error('Cash request approval error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
