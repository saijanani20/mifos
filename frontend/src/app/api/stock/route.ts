import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchParam = searchParams.get('branch');
    const searchParam = searchParams.get('search');
    const statusParam = searchParams.get('status');

    let query = adminSupabase
      .from('stock_items')
      .select('*')
      .order('created_at', { ascending: false });

    // Branch filter
    const activeBranch = branchParam || 'ALL';
    if (activeBranch !== 'ALL' && activeBranch.trim() !== '') {
      const branchTerms = getBranchSearchTerms(activeBranch);
      query = query.in('branch_id', branchTerms);
    }

    // Status filter (Active / Withdrawn)
    if (statusParam && statusParam !== 'ALL') {
      query = query.eq('status', statusParam);
    }

    // Bill / Item search filter
    if (searchParam && searchParam.trim() !== '') {
      const cleanSearch = searchParam.trim();
      query = query.or(`bill_no.ilike.%${cleanSearch}%,item_type.ilike.%${cleanSearch}%`);
    }

    // Limit up to 5000 items (covers entire branch inventory)
    const { data, error } = await query.limit(5000);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      items: data || [],
      count: (data || []).length
    });
  } catch (err: any) {
    console.error('Stock GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch stock items' }, { status: 500 });
  }
}
