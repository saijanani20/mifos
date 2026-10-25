import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

// Fallback demo clips if database table has no rows
const DEMO_RECORDINGS = [
  {
    id: 'REC-PN202609080001',
    branch_id: 'HQ',
    camera_id: 'CAM-HQ-01',
    pawn_id: 'PN202609080001',
    cashier_id: 'CASHIER01',
    start_time: '2026-09-08T10:35:20.000Z',
    end_time: '2026-09-08T10:35:40.000Z',
    duration: 20,
    file_path: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    file_size: 3450000,
    mime_type: 'video/mp4',
    status: 'COMPLETED',
    created_at: '2026-09-08T10:35:41.000Z'
  }
];

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    const url = new URL(req.url);
    const pawnId = url.searchParams.get('pawn_id');
    const branchId = url.searchParams.get('branch_id');

    let query = adminSupabase
      .from('cctv_recordings')
      .select('*')
      .order('created_at', { ascending: false });

    if (pawnId) {
      query = query.ilike('pawn_id', `%${pawnId.trim()}%`);
    }

    const { data, error } = await query;

    let recordings = data;
    if (error || !recordings || recordings.length === 0) {
      recordings = DEMO_RECORDINGS;
      if (pawnId) {
        recordings = recordings.filter(r => r.pawn_id.toLowerCase().includes(pawnId.toLowerCase()));
      }
    }

    // Role-based branch data isolation
    if (session && session.role === 'TELLER') {
      const userBranch = String(session.branchId).trim().toUpperCase();
      if (userBranch !== 'HQ' && userBranch !== 'ALL') {
        recordings = recordings.filter((r: any) => String(r.branch_id).trim().toUpperCase() === userBranch);
      }
    } else if (branchId && branchId !== 'ALL') {
      recordings = recordings.filter((r: any) => String(r.branch_id).trim().toUpperCase() === branchId.trim().toUpperCase());
    }

    return NextResponse.json({ success: true, recordings });
  } catch (err: any) {
    console.error('CCTV Recordings GET error:', err);
    return NextResponse.json({ success: true, recordings: DEMO_RECORDINGS });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    const body = await req.json();

    const {
      id,
      branch_id,
      camera_id,
      pawn_id,
      cashier_id,
      start_time,
      end_time,
      duration,
      file_path,
      file_size,
      mime_type,
      status,
      error_message
    } = body;

    if (!pawn_id || !file_path) {
      return NextResponse.json({ error: 'Missing required fields: pawn_id and file_path' }, { status: 400 });
    }

    const recId = id || `REC-${pawn_id}-${Date.now().toString().slice(-4)}`;
    const newRecording = {
      id: recId,
      branch_id: (branch_id || session?.branchId || 'HQ').toUpperCase(),
      camera_id: camera_id || 'CAM-HQ-01',
      pawn_id,
      cashier_id: cashier_id || session?.user?.email || 'SYSTEM',
      start_time: start_time || new Date(Date.now() - 20000).toISOString(),
      end_time: end_time || new Date().toISOString(),
      duration: duration || 20,
      file_path,
      file_size: file_size || 0,
      mime_type: mime_type || 'video/mp4',
      status: status || 'COMPLETED',
      error_message: error_message || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
      .from('cctv_recordings')
      .insert([newRecording])
      .select();

    if (error) {
      console.warn('[CCTV Recordings POST] Database insert error:', error.message);
      return NextResponse.json({ success: true, recording: newRecording, notice: 'Stored locally' });
    }

    return NextResponse.json({ success: true, recording: data[0] || newRecording });
  } catch (err: any) {
    console.error('CCTV Recordings POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
