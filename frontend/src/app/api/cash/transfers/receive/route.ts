import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase, validateFinancialActionAuth } from '@/lib/auth-server';
import { calculateDenominationTotal, generateCashReference, postCashTransferJournalEntry } from '@/lib/cash-management';
import { recordAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      transferId,
      denominations,
      securitySealVerified = true,
      discrepancyReason,
      resolutionNotes
    } = body;

    if (!transferId) {
      return NextResponse.json({ error: 'transferId is required.' }, { status: 400 });
    }

    // 1. Fetch Transfer and linked Dispatch Record
    const { data: transfer, error: fetchErr } = await adminSupabase
      .from('cash_transfers')
      .select('*, cash_dispatches(*)')
      .eq('id', transferId)
      .single();

    if (fetchErr || !transfer) {
      return NextResponse.json({ error: 'Cash transfer not found.' }, { status: 404 });
    }

    if (transfer.status !== 'IN_TRANSIT' && transfer.status !== 'DISPATCHED') {
      return NextResponse.json({
        error: `Cannot receive transfer with current status '${transfer.status}'. Transfer must be 'IN_TRANSIT'.`
      }, { status: 400 });
    }

    const dispatchRecord = Array.isArray(transfer.cash_dispatches) && transfer.cash_dispatches.length > 0
      ? transfer.cash_dispatches[0]
      : null;

    if (!dispatchRecord) {
      return NextResponse.json({ error: 'Corrupt state: No corresponding dispatch handover record found for this transfer.' }, { status: 409 });
    }

    // 2. Strict Destination Branch Security: Only staff authorized at destination branch can accept cash
    const authCheck = validateFinancialActionAuth(session, transfer.destination_branch_id, ['ADMIN', 'MANAGER', 'TELLER']);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 403 });
    }

    // 3. Segregation of Duties: Receiver CANNOT be the same user who dispatched
    if (dispatchRecord.dispatched_by_user_id === session.user.id) {
      return NextResponse.json({
        error: 'Segregation of Duties Violation: You cannot accept cash that you personally dispatched. A different authorized employee at the destination branch must verify and accept the cash.'
      }, { status: 403 });
    }

    // 4. Physical Denomination Verification on Receipt
    if (!denominations) {
      return NextResponse.json({ error: 'Physical currency denomination counts are required upon receipt.' }, { status: 400 });
    }

    const denomCalc = calculateDenominationTotal(denominations);
    if (!denomCalc.isValid) {
      return NextResponse.json({ error: denomCalc.error || 'Invalid denomination breakdown.' }, { status: 400 });
    }

    const receivedCash = denomCalc.total;
    const dispatchedCash = Number(dispatchRecord.dispatched_amount);
    const discrepancy = Number((receivedCash - dispatchedCash).toFixed(2));
    const hasDiscrepancy = Math.abs(discrepancy) > 0.01;

    if (hasDiscrepancy && !discrepancyReason?.trim()) {
      return NextResponse.json({
        error: `Physical count (Rs. ${receivedCash.toLocaleString()}) does not match dispatched amount (Rs. ${dispatchedCash.toLocaleString()}). Discrepancy explanation is required.`
      }, { status: 400 });
    }

    const receiptRef = generateCashReference('RCP');
    const receiptTime = new Date().toISOString();
    const finalTransferStatus = hasDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'ACCEPTED';

    // 5. Create Cash Receipt Record (Record 3: Acceptance)
    const { data: receiptRecord, error: receiptErr } = await adminSupabase
      .from('cash_receipts')
      .insert([{
        receipt_ref: receiptRef,
        transfer_id: transfer.id,
        dispatch_id: dispatchRecord.id,
        received_by_user_id: session.user.id,
        received_by_email: session.user.email || 'receiver@mifos.lk',
        received_amount: receivedCash,
        discrepancy_amount: discrepancy,
        security_seal_verified: Boolean(securitySealVerified),
        discrepancy_reason: hasDiscrepancy ? discrepancyReason.trim() : null,
        resolution_notes: resolutionNotes?.trim() || null,
        received_at: receiptTime,
        created_at: receiptTime
      }])
      .select()
      .single();

    if (receiptErr) {
      return NextResponse.json({ error: 'Failed to record cash receipt: ' + receiptErr.message }, { status: 500 });
    }

    // 6. Record Receipt Denominations
    await adminSupabase.from('cash_transfer_denominations').insert([{
      transfer_id: transfer.id,
      stage: 'RECEIPT',
      notes_5000: denomCalc.breakdown.notes_5000,
      notes_2000: denomCalc.breakdown.notes_2000,
      notes_1000: denomCalc.breakdown.notes_1000,
      notes_500:  denomCalc.breakdown.notes_500,
      notes_100:  denomCalc.breakdown.notes_100,
      notes_50:   denomCalc.breakdown.notes_50,
      notes_20:   denomCalc.breakdown.notes_20,
      notes_10:   denomCalc.breakdown.notes_10,
      coins_total: denomCalc.breakdown.coins_total,
      total_amount: receivedCash,
      recorded_by_user_id: session.user.id,
      created_at: receiptTime
    }]);

    // 7. General Ledger Double-Entry Posting (Only when fully balanced)
    let journalEntryId: string | null = null;
    if (!hasDiscrepancy) {
      const glResult = await postCashTransferJournalEntry({
        transferRef: transfer.transfer_ref,
        sourceBranch: transfer.source_branch_id,
        destBranch: transfer.destination_branch_id,
        amount: receivedCash,
        actorEmail: session.user.email || 'receiver@mifos.lk'
      });
      journalEntryId = glResult.journalEntryId;
    }

    // 8. Update Transfer Record
    await adminSupabase
      .from('cash_transfers')
      .update({
        status: finalTransferStatus,
        gl_journal_entry_id: journalEntryId,
        updated_at: receiptTime
      })
      .eq('id', transfer.id);

    // If linked to request, update request status
    if (transfer.request_id) {
      await adminSupabase
        .from('cash_requests')
        .update({
          status: hasDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'COMPLETED',
          updated_at: receiptTime
        })
        .eq('id', transfer.request_id);
    }

    // 9. Record Security & Financial Audit Log
    await recordAuditLog(session, {
      action: hasDiscrepancy ? 'CASH_TRANSFER_DISCREPANCY' : 'CASH_RECEIVED',
      resource: transfer.transfer_ref,
      branchId: transfer.destination_branch_id,
      status: hasDiscrepancy ? 'WARNING' : 'SUCCESS',
      details: {
        transferRef: transfer.transfer_ref,
        receiptRef,
        dispatchRef: dispatchRecord.dispatch_ref,
        sourceBranch: transfer.source_branch_id,
        destinationBranch: transfer.destination_branch_id,
        dispatchedAmount: dispatchedCash,
        receivedAmount: receivedCash,
        discrepancy,
        glJournalEntryId: journalEntryId,
        sealVerified: securitySealVerified
      }
    });

    return NextResponse.json({
      success: true,
      receipt: receiptRecord,
      transferStatus: finalTransferStatus,
      discrepancy,
      journalEntryId
    });

  } catch (err: any) {
    console.error('Cash receipt error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
