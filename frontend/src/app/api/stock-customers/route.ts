import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const { data, error } = await adminSupabase
      .from('stock_customers')
      .select('*')
      .order('name', { ascending: true })
      .limit(5000);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      customers: data || [],
      count: (data || []).length
    });
  } catch (err: any) {
    console.error('Stock customers GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch stock customers' }, { status: 500 });
  }
}
