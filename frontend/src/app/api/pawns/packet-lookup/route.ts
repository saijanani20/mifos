import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/auth-server';
import { extractBillNoFromQr } from '@/app/api/pawns/[id]/packet-qr/route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const qr = searchParams.get('qr');

    if (!qr || qr.trim() === '') {
      return NextResponse.json({ error: 'Missing QR code query parameter' }, { status: 400 });
    }

    const trimmedQr = qr.trim();
    let matchedBillNo: string | null = extractBillNoFromQr(trimmedQr);

    // If no structured format, check if the QR string directly matches a bill_no
    if (!matchedBillNo) {
      const { data: directBill } = await adminSupabase
        .from('pawns')
        .select('*')
        .ilike('bill_no', trimmedQr)
        .limit(1);

      if (directBill && directBill.length > 0) {
        matchedBillNo = directBill[0].bill_no;
      }
    }

    // Check if the QR matches pawns.packet_qr column
    if (!matchedBillNo) {
      try {
        const { data: packetMatch } = await adminSupabase
          .from('pawns')
          .select('*')
          .eq('packet_qr', trimmedQr)
          .limit(1);

        if (packetMatch && packetMatch.length > 0) {
          matchedBillNo = packetMatch[0].bill_no;
        }
      } catch (e) {
        // column might not exist yet, fallback to audit_logs
      }
    }

    // Check audit_logs for PACKET_STICKER_ATTACHED with this QR
    if (!matchedBillNo) {
      const { data: logs } = await adminSupabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'PACKET_STICKER_ATTACHED')
        .order('created_at', { ascending: false })
        .limit(100);

      const foundLog = (logs || []).find((l: any) => l.details?.packet_qr === trimmedQr);
      if (foundLog) {
        matchedBillNo = foundLog.resource || foundLog.details?.bill_no;
      }
    }

    if (!matchedBillNo) {
      return NextResponse.json({
        found: false,
        qr: trimmedQr,
        message: `No bill found matching packet sticker "${trimmedQr}". You can assign this sticker to a bill.`
      }, { status: 404 });
    }

    // Fetch full pawn details
    const { data: pawnData, error: pawnErr } = await adminSupabase
      .from('pawns')
      .select('*')
      .ilike('bill_no', matchedBillNo)
      .limit(1);

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
      pawn: {
        ...pawn,
        clients: client,
        items: items || []
      }
    });
  } catch (err: any) {
    console.error('GET /api/pawns/packet-lookup error:', err);
    return NextResponse.json({ error: err.message || 'Lookup failed' }, { status: 500 });
  }
}
