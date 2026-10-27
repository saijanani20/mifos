import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      const cookieHeader = request.headers.get('cookie') || '';
      const hasAuthCookie = cookieHeader.includes('sb-') || cookieHeader.includes('auth_');
      const hasBranchHeader = Boolean(request.headers.get('x-branch-id') || request.headers.get('authorization'));
      if (!hasAuthCookie && !hasBranchHeader) {
        return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const branchParam = searchParams.get('branch');
    const searchParam = searchParams.get('search');
    const statusParam = searchParams.get('status');

    const activeBranch = branchParam || 'ALL';

    // Paginated fetch to bypass PostgREST's 1000-row default limit
    let allItems: any[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = adminSupabase
        .from('stock_items')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      // Branch filter
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

      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allItems = allItems.concat(data);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    return NextResponse.json({
      success: true,
      items: allItems,
      count: allItems.length
    });
  } catch (err: any) {
    console.error('Stock GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch stock items' }, { status: 500 });
  }
}
