import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { extractBillNoFromQr } from '@/app/api/pawns/[id]/packet-qr/route';
import { stripBranchPrefix } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const qr = searchParams.get('qr');

    if (!qr || qr.trim() === '') {
      return NextResponse.json({ error: 'Missing QR code query parameter' }, { status: 400 });
    }

    const trimmedQr = qr.trim();
    let matchedBillNo: string | null = extractBillNoFromQr(trimmedQr);
    let matchedPawnId: string | null = null;

    // 1. Check if the QR matches pawns.packet_qr column directly
    try {
      const { data: packetMatch } = await adminSupabase
        .from('pawns')
        .select('id, bill_no, branch_id')
        .eq('packet_qr', trimmedQr)
        .limit(1);

      if (packetMatch && packetMatch.length > 0) {
        matchedPawnId = packetMatch[0].id;
        matchedBillNo = packetMatch[0].bill_no;
      }
    } catch (e) {
      // column might not exist yet, fallback to audit_logs
    }

    // 2. Check audit_logs for PACKET_STICKER_ATTACHED with this QR
    if (!matchedPawnId && !matchedBillNo) {
      const { data: logs } = await adminSupabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'PACKET_STICKER_ATTACHED')
        .filter('details->>packet_qr', 'eq', trimmedQr)
        .order('created_at', { ascending: false })
        .limit(1);

      if (logs && logs.length > 0) {
        matchedPawnId = logs[0].details?.pawn_id || null;
        matchedBillNo = logs[0].resource || logs[0].details?.bill_no;
      }
    }

    // 3. Fallback: check if the QR string directly matches a bill_no
    if (!matchedPawnId && !matchedBillNo) {
      const { data: directBill } = await adminSupabase
        .from('pawns')
        .select('id, bill_no')
        .ilike('bill_no', trimmedQr)
        .limit(1);

      if (directBill && directBill.length > 0) {
        matchedPawnId = directBill[0].id;
        matchedBillNo = directBill[0].bill_no;
      }
    }

    if (!matchedPawnId && !matchedBillNo) {
      return NextResponse.json({
        found: false,
        qr: trimmedQr,
        message: `No bill found matching packet sticker "${trimmedQr}". You can assign this sticker to a bill.`
      }, { status: 404 });
    }

    // Fetch full pawn details by exact unique UUID or bill_no
    let pawnQuery = adminSupabase.from('pawns').select('*');
    if (matchedPawnId) {
      pawnQuery = pawnQuery.eq('id', matchedPawnId);
    } else if (matchedBillNo) {
      pawnQuery = pawnQuery.ilike('bill_no', matchedBillNo);
    }
    const { data: pawnData, error: pawnErr } = await pawnQuery.limit(1);

    if (pawnErr || !pawnData || pawnData.length === 0) {
      return NextResponse.json({ found: false, qr: trimmedQr, bill_no: matchedBillNo }, { status: 404 });
    }

    const pawn = pawnData[0];

    // Fetch client
    let client = null;
    if (pawn.client_id) {
      const { data: c } = await adminSupabase.from('clients').select('*').eq('id', pawn.client_id).maybeSingle();
      client = c;
    }

    // Fetch items
    const { data: items } = await adminSupabase.from('pawn_items').select('*').eq('pawn_id', pawn.id);

    return NextResponse.json({
      found: true,
      qr: trimmedQr,
      bill_no: pawn.bill_no,
      display_bill_no: stripBranchPrefix(pawn.bill_no),
      pawn: {
        ...pawn,
        display_bill_no: stripBranchPrefix(pawn.bill_no),
        clients: client,
        items: items || []
      }
    });
  } catch (err: any) {
    console.error('GET /api/pawns/packet-lookup error:', err);
    return NextResponse.json({ error: err.message || 'Lookup failed' }, { status: 500 });
  }
}
