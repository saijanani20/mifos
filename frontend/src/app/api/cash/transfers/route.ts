import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
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

    let query = adminSupabase
      .from('cash_transfers')
      .select('*, cash_requests(*), cash_dispatches(*), cash_receipts(*), cash_transfer_denominations(*)')
      .order('created_at', { ascending: false });

    // Tellers see transfers involving their assigned branch
    if (session.role === 'TELLER') {
      const bId = session.trustedBranchId;
      query = query.or(`source_branch_id.eq.${bId},destination_branch_id.eq.${bId}`);
    } else if (branchFilter && branchFilter !== 'ALL') {
      const bId = normalizeBranchId(branchFilter);
      query = query.or(`source_branch_id.eq.${bId},destination_branch_id.eq.${bId}`);
    }

    if (statusFilter && statusFilter !== 'ALL') {
      query = query.eq('status', statusFilter);
    }

    const { data: transfers, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(transfers || []);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
