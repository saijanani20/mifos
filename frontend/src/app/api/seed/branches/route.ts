import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const INITIAL_BRANCHES = [
  { id: 'BRL', name: 'Borella' },
  { id: 'DHW', name: 'Dehiwala' },
  { id: 'DMT', name: 'Dematagoda' },
  { id: 'HMG', name: 'Homagama' },
  { id: 'KDW', name: 'Kadawatha' },
  { id: 'KIR', name: 'Kiribathgoda' },
  { id: 'KOT', name: 'Kotikawatta' },
  { id: 'KTW', name: 'Kottawa' },
  { id: 'PND', name: 'Panadura' },
  { id: 'W2',  name: 'Wattala 2' },
  { id: 'W3',  name: 'Wattala 3' },
  { id: 'W4',  name: 'Wattala 4' },
  { id: 'KHT', name: 'Kahathotuwa' },
  { id: 'HQ',  name: 'Head Office' },
];

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin authentication required.' }, { status: 403 });
    }

    if (!adminSupabase) {
      return NextResponse.json({ error: 'Database service not initialized' }, { status: 500 });
    }

    const results = [];
    for (const branch of INITIAL_BRANCHES) {
      const { error } = await adminSupabase
        .from('branches')
        .upsert({
          id: branch.id,
          name: branch.name,
          created_at: new Date().toISOString(),
          is_active: true
        }, { onConflict: 'id' })
        .select()
        .single();
      
      if (error) {
        results.push({ id: branch.id, status: 'error', error: error.message });
      } else {
        results.push({ id: branch.id, status: 'success' });
      }
    }

    return NextResponse.json({ 
      message: 'Branch seed finished.', 
      results
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
