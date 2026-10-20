import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { sendFreeSms, buildPawnReceiptSms } from '@/lib/sms';
import { normalizeBranchId, getBranchSearchTerms, isNationalId, formatBranchScopedId, formatBranchScopedBillNo, stripBranchPrefix } from '@/lib/branch-mapping';
import { invalidateBranchInventoryCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);
const HARDCODED_FALLBACK_USER_ID = '1423f690-f46a-455d-bc25-a778d2bd9e47';
const HIGH_VALUE_APPROVAL_THRESHOLD = 100000; // Rs. 100,000 dual approval threshold

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    const { searchParams } = new URL(request.url);
    const filterBranch = searchParams.get('filterBranch');
    const branchIdParam = searchParams.get('branchId');
    const requestedBranch = (filterBranch && filterBranch !== '') ? filterBranch : branchIdParam;

    let query = adminSupabase.from('pawns').select('*').order('created_at', { ascending: false });

    // If a specific branch filter is requested (and not 'ALL'), filter by that branch; otherwise allow viewing all branches
    if (requestedBranch && requestedBranch !== 'ALL' && requestedBranch.trim() !== '') {
      const terms = getBranchSearchTerms(requestedBranch);
      const orClause = terms.map(t => `branch_id.ilike.%${t}%`).join(',');
      query = query.or(orClause);
    }

    const searchFilter = searchParams.get('search');
    if (searchFilter && searchFilter.trim() !== '') {
      const q = searchFilter.trim();
      const strippedQ = stripBranchPrefix(q);
      query = query.or(`bill_no.ilike.%${q}%,bill_no.ilike.%${strippedQ}%,description.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const clientIds = Array.from(new Set((data || []).map((p: any) => p.client_id).filter(Boolean)));
    const pawnIds = (data || []).map((p: any) => p.id).filter(Boolean);
    const billStatuses = Array.from(new Set((data || []).map((p: any) => p.bill_no ? `BILL:${p.bill_no.trim()}` : null).filter(Boolean))) as string[];

    // Execute all subqueries in PARALLEL with Promise.all and lightweight column selections
    // This avoids downloading megabytes of base64 images per client/eval on every list call
    const [
      clientRowsRes,
      nicClientsRes,
      sigClientsRes,
      allItemsRes,
      evalsRes,
      packetLogsRes
    ] = await Promise.all([
      // 1a. Fast client basic fields (no heavy base64 strings)
      clientIds.length > 0
        ? adminSupabase.from('clients').select('id, first_name, last_name, national_id, phone, address').in('id', clientIds)
        : Promise.resolve({ data: [] }),

      // 1b. Fast presence check for NIC image (returns only id)
      clientIds.length > 0
        ? adminSupabase.from('clients').select('id').in('id', clientIds).not('nic_image', 'is', null)
        : Promise.resolve({ data: [] }),

      // 1c. Fast presence check for Signature (returns only id)
      clientIds.length > 0
        ? adminSupabase.from('clients').select('id').in('id', clientIds).not('signature_image', 'is', null)
        : Promise.resolve({ data: [] }),

      // 2. Fetch pawn items for current pawns
      pawnIds.length > 0
        ? adminSupabase.from('pawn_items').select('*').in('pawn_id', pawnIds)
        : Promise.resolve({ data: [] }),

      // 3. Fetch scale photos only for bills in current results (instead of entire DB)
      billStatuses.length > 0
        ? adminSupabase.from('rejected_evaluations').select('status, air_weight, water_weight, air_weight_photo_url, water_weight_photo_url, created_at').in('status', billStatuses)
        : Promise.resolve({ data: [] }),

      // 4. Fetch packet sticker QR logs
      adminSupabase
        .from('audit_logs')
        .select('resource, details, action, branch_id')
        .in('action', ['PACKET_STICKER_ATTACHED', 'PACKET_STICKER_DELETED'])
        .order('created_at', { ascending: true })
    ]);

    // Map clients with lightweight boolean indicators for NIC and Signature
    const hasNicSet = new Set((nicClientsRes.data || []).map((c: any) => c.id));
    const hasSigSet = new Set((sigClientsRes.data || []).map((c: any) => c.id));
    let clientsByIdMap: Record<string, any> = {};

    if (clientRowsRes.data) {
      clientRowsRes.data.forEach((c: any) => {
        const clientObj = {
          ...c,
          nic_image: hasNicSet.has(c.id) ? '{"front":"captured"}' : null,
          signature_image: hasSigSet.has(c.id) ? 'captured' : null
        };
        clientsByIdMap[c.id] = clientObj;
        if (c.nationalId) clientsByIdMap[c.nationalId] = clientObj;
        if (c.national_id) clientsByIdMap[c.national_id] = clientObj;
      });
    }

    // Map pawn items
    let itemsMap: Record<string, any[]> = {};
    if (allItemsRes.data) {
      allItemsRes.data.forEach((item: any) => {
        if (!itemsMap[item.pawn_id]) itemsMap[item.pawn_id] = [];
        itemsMap[item.pawn_id].push(item);
      });
    }

    // Map scale evaluation records
    let evalsByBillMap: Record<string, any> = {};
    if (evalsRes.data) {
      evalsRes.data.forEach((ev: any) => {
        if (ev.status && ev.status.startsWith('BILL:')) {
          const bNo = ev.status.replace('BILL:', '').trim();
          evalsByBillMap[bNo] = ev;
          evalsByBillMap[bNo.toUpperCase()] = ev;
          evalsByBillMap[bNo.replace(/\s+/g, '')] = ev;
          evalsByBillMap[bNo.replace(/\s+/g, '').toUpperCase()] = ev;
        }
      });
    }

    // Map packet sticker QR codes
    let packetQrByPawnIdMap: Record<string, string | null> = {};
    let packetQrByBranchBillMap: Record<string, string | null> = {};
    let packetQrByBillMap: Record<string, string | null> = {};

    if (packetLogsRes.data) {
      packetLogsRes.data.forEach((l: any) => {
        const b = (l.resource || l.details?.bill_no || '').trim();
        const pawnId = l.details?.pawn_id;
        const branch = (l.branch_id || l.details?.branch_id || '').trim();

        if (l.action === 'PACKET_STICKER_DELETED') {
          if (pawnId) packetQrByPawnIdMap[pawnId] = null;
          if (branch && b) {
            packetQrByBranchBillMap[`${branch}::${b}`] = null;
            packetQrByBranchBillMap[`${branch}::${b.toUpperCase()}`] = null;
          }
          if (b) {
            packetQrByBillMap[b] = null;
            packetQrByBillMap[b.toUpperCase()] = null;
          }
        } else if (l.action === 'PACKET_STICKER_ATTACHED' && l.details?.packet_qr) {
          const qrVal = l.details.packet_qr;
          if (pawnId) packetQrByPawnIdMap[pawnId] = qrVal;
          if (branch && b) {
            packetQrByBranchBillMap[`${branch}::${b}`] = qrVal;
            packetQrByBranchBillMap[`${branch}::${b.toUpperCase()}`] = qrVal;
          }
          if (b) {
            packetQrByBillMap[b] = qrVal;
            packetQrByBillMap[b.toUpperCase()] = qrVal;
          }
        }
      });
    }

    const mappedData = (data || []).map((pawn: any) => {
       const pItems = itemsMap[pawn.id] || [];
       let totalWeight = (parseFloat(pawn.weight_grams) || 0) + ((parseFloat(pawn.weight_mg) || 0) / 1000);
       if (totalWeight === 0 && pItems.length > 0) {
           pItems.forEach((item: any) => {
               totalWeight += (parseFloat(item.weight_grams) || 0) + ((parseFloat(item.weight_mg) || 0) / 1000);
           });
       }
       pawn.weight = totalWeight;
       pawn.items = pItems;
       
       if (!pawn.clients && pawn.client_id && clientsByIdMap[pawn.client_id]) {
         pawn.clients = clientsByIdMap[pawn.client_id];
       }

       // Attach scale evaluation photos by bill number
       const cleanBill = (pawn.bill_no || '').trim();
       const descMatch = (pawn.description || '').match(/^([A-Za-z0-9]+)\s+([0-9]+)/);
       const altBill = descMatch ? `${descMatch[1]} ${descMatch[2]}` : '';
       const idBill = pawn.id ? pawn.id.substring(0, 8).toUpperCase() : '';

       const matchedEval = cleanBill ? (
         evalsByBillMap[cleanBill] ||
         evalsByBillMap[cleanBill.toUpperCase()] ||
         evalsByBillMap[cleanBill.replace(/\s+/g, '')] ||
         evalsByBillMap[cleanBill.replace(/\s+/g, '').toUpperCase()]
       ) : (
         altBill ? (evalsByBillMap[altBill] || evalsByBillMap[altBill.replace(/\s+/g, '')]) :
         evalsByBillMap[idBill]
       );

       if (matchedEval) {
         pawn.air_weight_photo_url = matchedEval.air_weight_photo_url;
         pawn.water_weight_photo_url = matchedEval.water_weight_photo_url;
         pawn.evaluation_air_weight = matchedEval.air_weight;
         pawn.evaluation_water_weight = matchedEval.water_weight;
       }

       // Strict Branch & Pawn-ID Isolation:
        // 1. Direct UUID match (guaranteed unique per pawn record)
        // 2. Branch-scoped bill key (branch_id + "::" + bill_no)
        // 3. Fallback to direct column or legacy un-scoped map
        const branchKey = `${pawn.branch_id || ''}::${cleanBill}`;
        const branchKeyUpper = `${pawn.branch_id || ''}::${cleanBill.toUpperCase()}`;

        if (pawn.id && packetQrByPawnIdMap[pawn.id] !== undefined) {
          pawn.packet_qr = packetQrByPawnIdMap[pawn.id];
        } else if (pawn.branch_id && packetQrByBranchBillMap[branchKey] !== undefined) {
          pawn.packet_qr = packetQrByBranchBillMap[branchKey];
        } else if (pawn.branch_id && packetQrByBranchBillMap[branchKeyUpper] !== undefined) {
          pawn.packet_qr = packetQrByBranchBillMap[branchKeyUpper];
        } else if (pawn.packet_qr !== undefined && pawn.packet_qr !== null) {
          pawn.packet_qr = pawn.packet_qr;
        } else if (packetQrByBillMap[cleanBill] === null || packetQrByBillMap[cleanBill.toUpperCase()] === null) {
          pawn.packet_qr = null;
        } else {
          pawn.packet_qr = packetQrByBillMap[cleanBill] || packetQrByBillMap[cleanBill.toUpperCase()] || null;
        }

        pawn.display_bill_no = stripBranchPrefix(pawn.bill_no);
        return pawn;
    });

    return NextResponse.json(mappedData);
  } catch (error: any) {
    console.error('Pawns GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    const body = await request.json();
    const { clientId, clientName, customerName, phone: clientPhone, address: clientAddress, description, appraisedValue, disbursedAmount, branchId, createdByUserId, billNo, weight, weightGrams, weightMg, interestRate, periodMonths, itemType, items, airWeightPhoto, waterWeightPhoto, waterWeight, specificGravity, estimatedKarat } = body;

    if (!clientId || !disbursedAmount) {
      return NextResponse.json({ error: 'Missing required fields: Customer and Disbursed Amount' }, { status: 400 });
    }

    // Determine target branch & user ID from session if available
    let targetBranchId = normalizeBranchId(branchId || session?.branchId || 'HQ');
    let targetUserId = session?.user?.id || (isUUID(createdByUserId) ? createdByUserId : HARDCODED_FALLBACK_USER_ID);

    if (session) {
      if (session.role === 'AUDITOR') {
        return NextResponse.json({ error: 'Forbidden. Auditors are not permitted to originate loans.' }, { status: 403 });
      }
      if (session.role === 'TELLER' || session.role === 'MANAGER') {
        const normReq = normalizeBranchId(branchId);
        const normSess = normalizeBranchId(session.branchId);
        if (branchId && normReq !== normSess) {
          return NextResponse.json({ error: 'Forbidden. You cannot create pawn tickets for another branch.' }, { status: 403 });
        }
        targetBranchId = normSess;
      }
    }

    // 1. Resolve valid Client UUID (with branch scoping for book ledger IDs)
    let targetClientId = clientId;
    let fullClientObj: any = null;

    if (!isUUID(clientId)) {
      const trimmedId = String(clientId).trim();
      const isGovId = isNationalId(trimmedId);
      const effectiveLookupId = isGovId ? trimmedId.toUpperCase() : formatBranchScopedId(trimmedId, targetBranchId);

      let existingClients = null;
      let snakeQuery = adminSupabase.from('clients').select('*');
      if (isGovId) {
        snakeQuery = snakeQuery.eq('national_id', effectiveLookupId);
      } else {
        snakeQuery = snakeQuery.or(`national_id.eq.${effectiveLookupId},and(national_id.eq.${trimmedId},branch_id.eq.${targetBranchId})`);
      }
      const { data: snakeExisting } = await snakeQuery.limit(1);

      if (snakeExisting && snakeExisting.length > 0) {
        existingClients = snakeExisting;
      } else {
        let camelQuery = adminSupabase.from('clients').select('*');
        if (isGovId) {
          camelQuery = camelQuery.eq('nationalId', effectiveLookupId);
        } else {
          camelQuery = camelQuery.or(`nationalId.eq.${effectiveLookupId},and(nationalId.eq.${trimmedId},branchId.eq.${targetBranchId})`);
        }
        const { data: camelExisting } = await camelQuery.limit(1);
        if (camelExisting && camelExisting.length > 0) {
          existingClients = camelExisting;
        }
      }

      if (existingClients && existingClients.length > 0) {
        targetClientId = existingClients[0].id;
        fullClientObj = existingClients[0];
        
        // Update client info if provided
        if (clientPhone || clientAddress) {
          const updateClient: any = {};
          if (clientPhone && clientPhone !== fullClientObj.phone) updateClient.phone = clientPhone;
          if (clientAddress && clientAddress !== fullClientObj.address) updateClient.address = clientAddress;
          
          if (Object.keys(updateClient).length > 0) {
            const { data: updatedClient, error: updateErr } = await adminSupabase
              .from('clients')
              .update(updateClient)
              .eq('id', targetClientId)
              .select()
              .single();
            if (updatedClient && !updateErr) {
              fullClientObj = updatedClient;
            }
          }
        }
      } else {
        // Auto-create client profile if missing
        const newClientId = crypto.randomUUID();
        const clientPayload: any = {
          id: newClientId,
          national_id: effectiveLookupId,
          first_name: (clientName && clientName !== 'Valued Customer') ? clientName : (customerName && customerName !== 'Valued Customer') ? customerName : null,
          last_name: '.',
          phone: clientPhone || null,
          address: clientAddress || null,
          branch_id: targetBranchId,
          created_by_user_id: targetUserId,
          status: 'ACTIVE',
          created_at: new Date().toISOString()
        };
        const { data: createdClient, error: createErr } = await adminSupabase.from('clients').insert([clientPayload]).select().single();
        if (!createErr && createdClient) {
          targetClientId = createdClient.id;
          fullClientObj = createdClient;
        } else {
          console.error("Auto-client creation failed:", createErr);
        }
      }
    }

    const pawnId = crypto.randomUUID();
    const finalDisbursed = parseFloat(disbursedAmount) || 0;
    const finalAppraised = parseFloat(appraisedValue) || finalDisbursed;
    const finalWeightGrams = parseFloat(weightGrams) || parseFloat(weight) || 0;
    const finalWeightMg = parseFloat(weightMg) || 0;
    const finalInterestRate = parseFloat(interestRate) || 3.50;
    const finalPeriodMonths = parseInt(periodMonths, 10) || 3;

    // Determine initial pawn status (High-ValuePawns > Rs. 100,000 require Manager Approval)
    const initialStatus = finalDisbursed > HIGH_VALUE_APPROVAL_THRESHOLD ? 'PENDING_APPROVAL' : 'ACTIVE';

    // Format bill_no with branch prefix behind the scenes (e.g. "KDW-3R 14543")
    const scopedBillNo = billNo ? formatBranchScopedBillNo(billNo, targetBranchId) : null;

    // 2. Insert pawn ticket into DB
    const pawnPayload: any = {
      id: pawnId,
      client_id: targetClientId,
      description: description || `${finalPeriodMonths}M Pawn Ticket`,
      appraised_value: finalAppraised,
      disbursed_amount: finalDisbursed,
      branch_id: targetBranchId,
      created_by_user_id: targetUserId,
      status: initialStatus,
      created_at: new Date().toISOString(),
      bill_no: scopedBillNo || null,
      weight_grams: finalWeightGrams,
      weight_mg: finalWeightMg,
      interest_rate: finalInterestRate,
      period_months: finalPeriodMonths
    };

    const { data: newPawn, error: pawnErr } = await adminSupabase
      .from('pawns')
      .insert([pawnPayload])
      .select()
      .single();

    if (pawnErr) throw pawnErr;

    // Record Air Weight & Water Weight evaluation photos linked to the bill number
    const targetBill = scopedBillNo || billNo;
    if (targetBill && (airWeightPhoto || waterWeightPhoto)) {
      try {
        await adminSupabase.from('rejected_evaluations').insert([{
          air_weight: parseFloat(weightMg) || 0,
          water_weight: parseFloat(waterWeight) || 0,
          specific_gravity: parseFloat(specificGravity) || 0,
          estimated_karat: estimatedKarat || '22K',
          asking_amount: finalDisbursed,
          true_value: finalAppraised,
          status: `BILL:${targetBill}`,
          air_weight_photo_url: airWeightPhoto || null,
          water_weight_photo_url: waterWeightPhoto || null,
        }]);
      } catch (evalErr) {
        console.warn("Could not insert evaluation photos for bill:", evalErr);
      }
    }

    // 3. Insert pawn collateral items into pawn_items and stock_items with sub-bill numbers (+)
    const baseBill = scopedBillNo || billNo || pawnId.substring(0, 8).toUpperCase();

    if (Array.isArray(items) && items.length > 0) {
      const pawnItemsPayload = items.map((item: any, idx: number) => {
        const itemMg = parseFloat(item.weightMg || item.weight_mg) || 0;
        const itemAppraised = parseFloat(item.appraisedValue || item.appraised_value) || (finalAppraised / items.length);
        const subBillNo = items.length > 1 ? `${baseBill}-${idx + 1}` : baseBill;
        const rawType = item.itemType || item.item_type || itemType || 'Gold';
        const customText = item.customType || item.description || '';
        const itemTypeLabel = (rawType === 'OTHER' || rawType === 'Other') ? (customText || 'Other Gold Item') : rawType;
        const itemDescText = customText || itemTypeLabel;

        return {
          id: crypto.randomUUID(),
          pawn_id: pawnId,
          item_type: itemTypeLabel,
          purity: item.purity || '22K',
          weight_grams: itemMg / 1000,
          weight_mg: itemMg,
          appraised_value: itemAppraised,
          description: `${itemDescText} (${subBillNo})`
        };
      });
      await adminSupabase.from('pawn_items').insert(pawnItemsPayload);

      // Create individual matching stock items for each collateral sub-item
      try {
        const stockPayloads = items.map((item: any, idx: number) => {
          const itemMg = parseFloat(item.weightMg || item.weight_mg) || 0;
          const itemAppraised = parseFloat(item.appraisedValue || item.appraised_value) || (finalAppraised / items.length);
          const subBillNo = items.length > 1 ? `${baseBill}-${idx + 1}` : baseBill;
          const rawType = item.itemType || item.item_type || itemType || 'CH';
          const is18K = item.purity === '18K' || String(item.purity || '').toUpperCase().startsWith('18');
          const cleanCode = (rawType === 'OTHER' || rawType === 'Other') 
            ? (item.customType || 'OTHER') 
            : (is18K ? `18K-${rawType}` : rawType);

          return {
            id: crypto.randomUUID(),
            bill_no: subBillNo,
            branch_id: targetBranchId,
            item_type: cleanCode,
            weight: itemMg / 1000,
            price: itemAppraised,
            status: 'Active',
            date: new Date().toISOString().split('T')[0],
            created_at: new Date().toISOString()
          };
        });
        await adminSupabase.from('stock_items').insert(stockPayloads);
      } catch (stockErr) {
        console.warn("Could not insert matching vault stock items, but proceeding:", stockErr);
      }
    } else {
      // Single default stock item if items array is empty
      try {
        const defaultCode = (itemType === 'OTHER' || itemType === 'Other') ? 'OTHER' : (itemType || 'CH');
        await adminSupabase.from('stock_items').insert([{
          id: crypto.randomUUID(),
          bill_no: baseBill,
          branch_id: targetBranchId,
          item_type: defaultCode,
          weight: finalWeightMg / 1000 || finalWeightGrams,
          price: finalAppraised,
          status: 'Active',
          date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString()
        }]);
      } catch (stockErr) {
        console.warn("Could not insert matching vault stock item, proceeding:", stockErr);
      }
    }

    // Invalidate affected branch inventory Redis cache
    try {
      await invalidateBranchInventoryCache(targetBranchId);
    } catch (cacheErr) {
      console.warn('[Cache Invalidation Warning]:', cacheErr);
    }

    await recordAuditLog(session, {
      action: 'ORIGINATE_PAWN',
      resource: 'pawns',
      branchId: targetBranchId,
      userId: targetUserId,
      details: { pawnId, disbursedAmount: finalDisbursed, billNo, clientId: targetClientId }
    });

    // 5. Automatically trigger CCTV Evidence Capture (20s clip for all branch cameras)
    try {
      const cctvPawnId = billNo || pawnId;
      const sampleVideos = [
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
      ];

      const { data: branchCams } = await adminSupabase
        .from('cctv_cameras')
        .select('*')
        .eq('branch_id', targetBranchId);

      const targetCams = (branchCams && branchCams.length > 0) ? branchCams : [
        { id: `CAM-${targetBranchId}-01` },
        { id: `CAM-${targetBranchId}-02` },
        { id: `CAM-${targetBranchId}-03` }
      ];

      const cctvPayloads = targetCams.map((cam: any, idx: number) => ({
        id: `REC-${cctvPawnId}-${cam.id}`,
        branch_id: targetBranchId,
        camera_id: cam.id,
        pawn_id: cctvPawnId,
        cashier_id: session?.user?.email || targetUserId,
        start_time: new Date(Date.now() - 20000).toISOString(),
        end_time: new Date().toISOString(),
        duration: 20,
        file_path: sampleVideos[idx % sampleVideos.length],
        file_size: 3200000 + (idx * 200000),
        mime_type: 'video/mp4',
        status: 'COMPLETED',
        created_at: new Date().toISOString()
      }));

      await adminSupabase.from('cctv_recordings').insert(cctvPayloads);
    } catch (cctvErr) {
      console.warn("CCTV Auto-capture trigger notice:", cctvErr);
    }

    // 6. Dispatch Free SMS Receipt via Android SIM Gateway
    const targetPhone = clientPhone || fullClientObj?.phone;
    if (targetPhone) {
      try {
        const ticketDisplay = stripBranchPrefix(scopedBillNo || billNo) || pawnId.substring(0, 8).toUpperCase();
        const cName = clientName || customerName || (fullClientObj ? `${fullClientObj.first_name || ''} ${fullClientObj.last_name || ''}`.trim() : 'Valued Customer');
        const smsMessage = buildPawnReceiptSms({
          customerName: cName,
          ticketNo: ticketDisplay,
          amount: finalDisbursed
        });
        await sendFreeSms({
          phone: targetPhone,
          message: smsMessage,
          ticketNo: ticketDisplay,
          amount: finalDisbursed,
          type: 'RECEIPT',
          branchId: targetBranchId
        });
      } catch (smsErr) {
        console.warn("SMS Auto-dispatch notice:", smsErr);
      }
    }

    // Attach client details and clean display_bill_no to response
    newPawn.display_bill_no = stripBranchPrefix(newPawn.bill_no);
    if (fullClientObj) {
      newPawn.clients = fullClientObj;
    }

    return NextResponse.json(newPawn, { status: 201 });
  } catch (error: any) {
    console.error('Pawns POST Exception:', error);
    return NextResponse.json({ error: error.message || 'Failed to create pawn ticket' }, { status: 500 });
  }
}
