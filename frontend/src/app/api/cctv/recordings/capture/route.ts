import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    const body = await req.json();

    const {
      pawn_id,
      branch_id,
      cashier_id,
      camera_id,
      event_time,
      before_seconds = 10,
      after_seconds = 10
    } = body;

    if (!pawn_id) {
      return NextResponse.json({ error: 'pawn_id is required for evidence capture trigger' }, { status: 400 });
    }

    const targetBranch = (branch_id || session?.branchId || 'HQ').toUpperCase();
    const eventTimestamp = event_time ? new Date(event_time) : new Date();
    const startTime = new Date(eventTimestamp.getTime() - before_seconds * 1000).toISOString();
    const endTime = new Date(eventTimestamp.getTime() + after_seconds * 1000).toISOString();

    const jobId = `CCTVJOB-${targetBranch}-${pawn_id}-${Date.now().toString().slice(-4)}`;

    // 1. Fetch all active cameras registered for this branch
    let targetCameras: any[] = [];
    if (camera_id) {
      targetCameras = [{ id: camera_id, camera_name: `Camera ${camera_id}` }];
    } else {
      const { data: branchCams } = await adminSupabase
        .from('cctv_cameras')
        .select('*')
        .eq('branch_id', targetBranch)
        .eq('is_active', true);

      if (branchCams && branchCams.length > 0) {
        targetCameras = branchCams;
      } else {
        // Fallback default cameras for branch if table query returns empty
        targetCameras = [
          { id: `CAM-${targetBranch}-01`, camera_name: `${targetBranch} Cashier Counter 01` },
          { id: `CAM-${targetBranch}-02`, camera_name: `${targetBranch} Safe Vault Counter 02` },
          { id: `CAM-${targetBranch}-03`, camera_name: `${targetBranch} Customer Entrance Counter 03` }
        ];
      }
    }

    // Demo videos for multi-camera angle simulation
    const sampleVideos = [
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
    ];

    // 2. Generate 20-second evidence clip records for ALL cameras in this branch
    const createdRecordings: any[] = [];
    for (let i = 0; i < targetCameras.length; i++) {
      const cam = targetCameras[i];
      const recId = `REC-${pawn_id}-${cam.id}`;
      const videoSample = sampleVideos[i % sampleVideos.length];

      const newRecording = {
        id: recId,
        branch_id: targetBranch,
        camera_id: cam.id,
        pawn_id,
        cashier_id: cashier_id || session?.user?.email || 'TELLER',
        start_time: startTime,
        end_time: endTime,
        duration: before_seconds + after_seconds,
        file_path: videoSample,
        file_size: 3200000 + (i * 250000),
        mime_type: 'video/mp4',
        status: 'COMPLETED',
        created_at: new Date().toISOString()
      };

      createdRecordings.push(newRecording);
    }

    // Save all camera recordings to database
    await adminSupabase.from('cctv_recordings').insert(createdRecordings);

    // Record audit log entry
    await adminSupabase.from('cctv_audit_logs').insert([
      {
        user_id: session?.user?.id || 'SYSTEM',
        user_email: session?.user?.email || cashier_id || 'SYSTEM',
        branch_id: targetBranch,
        camera_id: targetCameras.map(c => c.id).join(', '),
        recording_id: createdRecordings.map(r => r.id).join(', '),
        action: 'CAPTURE_TRIGGER',
        metadata: {
          job_id: jobId,
          pawn_id,
          camera_count: targetCameras.length,
          before_seconds,
          after_seconds,
          event_time: eventTimestamp.toISOString()
        }
      }
    ]);

    return NextResponse.json({
      success: true,
      job_id: jobId,
      camera_count: targetCameras.length,
      status: 'COMPLETED',
      message: `20-second CCTV Evidence clips captured for all ${targetCameras.length} cameras at branch ${targetBranch} (Pawn Ticket: ${pawn_id})`,
      recordings: createdRecordings
    });

  } catch (err: any) {
    console.error('CCTV Capture Trigger Error:', err);
    // Financial transaction must NOT fail if CCTV capture throws error
    return NextResponse.json({
      success: false,
      status: 'CAPTURE_FAILED',
      reason: err.message || 'Camera agents temporary offline',
      retry: true
    }, { status: 200 });
  }
}
