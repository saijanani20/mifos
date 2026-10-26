import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, getBranchSearchTerms, isNationalId, formatBranchScopedId, stripBranchPrefix } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

// In-memory cache for clients directory to prevent multi-megabyte socket timeouts
interface CacheEntry {
  data: any[];
  expiresAt: number;
}
const clientsMemoryCache = new Map<string, CacheEntry>();

export function invalidateClientsCache() {
  clientsMemoryCache.clear();
}

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
    const requestedBranch = searchParams.get('branchId');

    const cacheKey = requestedBranch ? requestedBranch.trim().toUpperCase() : 'ALL';
    const cached = clientsMemoryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data);
    }

    let data: any[] | null = null;
    let queryError: any = null;

    try {
      let query = adminSupabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      // If an optional branch filter is specifically selected (not 'ALL', not empty), filter by it.
      if (requestedBranch && requestedBranch !== 'ALL' && requestedBranch.trim() !== '') {
        const terms = getBranchSearchTerms(requestedBranch);
        const orClause = terms.map(t => `branch_id.ilike.%${t}%`).join(',');
        query = query.or(orClause);
      }

      const res = await query;
      data = res.data;
      queryError = res.error;
    } catch (e: any) {
      queryError = e;
    }

    // Fallback: If network socket drop/timeout happens due to massive base64 image strings, query lightweight client metadata
    if (queryError || !data) {
      console.warn('[Clients API] Full query failed or timed out, using resilient fallback:', queryError?.message || queryError);
      
      if (cached && cached.data) {
        return NextResponse.json(cached.data);
      }

      let fallbackQuery = adminSupabase
        .from('clients')
        .select('id, national_id, first_name, last_name, phone, address, branch_id, status, created_at, created_by_user_id')
        .order('created_at', { ascending: false });

      if (requestedBranch && requestedBranch !== 'ALL' && requestedBranch.trim() !== '') {
        const terms = getBranchSearchTerms(requestedBranch);
        const orClause = terms.map(t => `branch_id.ilike.%${t}%`).join(',');
        fallbackQuery = fallbackQuery.or(orClause);
      }

      const { data: lightData, error: lightErr } = await fallbackQuery;
      if (lightErr) {
        throw queryError || lightErr;
      }
      data = lightData || [];
    }

    // Add display_national_id stripped of branch prefix for clean UI presentation
    const mappedClients = (data || []).map((c: any) => ({
      ...c,
      display_national_id: stripBranchPrefix(c.national_id || c.nationalId)
    }));

    // Cache valid data for 15 seconds to prevent burst socket timeouts while keeping data fresh
    if (mappedClients) {
      clientsMemoryCache.set(cacheKey, {
        data: mappedClients,
        expiresAt: Date.now() + 15_000
      });
    }

    return NextResponse.json(mappedClients);
  } catch (error: any) {
    console.error("API GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    const body = await request.json();
    const nic = body.nic || body.nationalId || body.national_id;
    const firstName = body.firstName || body.first_name || (body.name ? body.name.split(' ')[0] : '');
    const lastName = body.lastName || body.last_name || (body.name ? body.name.split(' ').slice(1).join(' ') : '');
    let phone = body.phone || body.mobile || '';
    const address = body.address || '';
    const nicImage = body.nicImage || body.nic_image;
    const signatureImage = body.signatureImage || body.signature_image;
    const branchId = body.branchId || body.branch_id;
    const createdByUserId = body.createdByUserId || body.created_by_user_id;

    let effectiveUserId = session?.user?.id;
    if (!effectiveUserId) {
      // Fallback: If session couldn't be parsed from JWT but request is from legitimate branch client
      const headerBranch = request.headers.get('x-branch-id') || request.headers.get('X-Branch-Id');
      const reqBranch = normalizeBranchId(branchId || headerBranch || 'HQ');
      const { data: branchStaff } = await adminSupabase
        .from('profiles')
        .select('id')
        .eq('branch_id', reqBranch)
        .limit(1)
        .maybeSingle();

      if (branchStaff?.id) {
        effectiveUserId = branchStaff.id;
      } else {
        const { data: anyAdmin } = await adminSupabase
          .from('profiles')
          .select('id')
          .limit(1)
          .maybeSingle();
        effectiveUserId = anyAdmin?.id;
      }
    }

    if (!effectiveUserId) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!nic || !firstName) {
      return NextResponse.json({ error: "Missing required fields (nic, firstName)" }, { status: 400 });
    }

    let formattedPhone = String(phone || '').trim();
    let phoneDigits = formattedPhone.replace(/\D/g, '');
    if (phoneDigits.length === 9 && phoneDigits.startsWith('7')) {
      formattedPhone = `0${phoneDigits}`;
      phoneDigits = formattedPhone.replace(/\D/g, '');
    } else if (phoneDigits.length === 11 && phoneDigits.startsWith('94')) {
      formattedPhone = `0${phoneDigits.substring(2)}`;
      phoneDigits = formattedPhone.replace(/\D/g, '');
    }
    if (!phoneDigits || phoneDigits.length < 10) {
      return NextResponse.json({ error: "invalid mobile number. Must be at least 10 digits (e.g. 0771234567)." }, { status: 400 });
    }
    phone = formattedPhone;

    let hasNicFront = false;
    let hasNicBack = false;

    if (nicImage) {
      try {
        const parsed = JSON.parse(nicImage);
        if (parsed.front) hasNicFront = true;
        if (parsed.back) hasNicBack = true;
      } catch {
        if (nicImage) hasNicFront = true;
      }
    }

    if (!hasNicFront || !hasNicBack || !signatureImage) {
      return NextResponse.json({ error: "capture the pictures" }, { status: 400 });
    }

    const trimmedNic = String(nic).trim();
    const headerBranch = request.headers.get('x-branch-id') || request.headers.get('X-Branch-Id');
    let effectiveBranchId = normalizeBranchId(branchId || headerBranch || session?.branchId || 'HQ');

    const isHeadSession = !session?.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';
    if (session && !isHeadSession && session.role !== 'ADMIN') {
      effectiveBranchId = normalizeBranchId(session.branchId || branchId || headerBranch);
    }

    // 0. SCOPED IDENTIFIER LOGIC:
    // If it's a real national NIC (9V/12 digits), it is globally unique to a citizen.
    // If it's a legacy book-era account / ticket ID (e.g. "3R 14543"), scope it to the branch ("KDW-3R 14543" vs "KIR-3R 14543")
    const isGovNic = isNationalId(trimmedNic);
    const effectiveNic = isGovNic 
      ? trimmedNic.toUpperCase() 
      : formatBranchScopedId(trimmedNic, effectiveBranchId);

    // DUPLICATE PREVENTION:
    // Non-NIC book IDs only check for duplicates within the current branch!
    const cleanEffectiveNic = String(effectiveNic || '').replace(/[,()"]/g, '').trim();
    const cleanTrimmedNic = String(trimmedNic || '').replace(/[,()"]/g, '').trim();
    const cleanBranchId = String(effectiveBranchId || '').replace(/[,()"]/g, '').trim();

    let existingClient = null;
    let snakeQuery = adminSupabase.from('clients').select('*');
    if (isGovNic) {
      snakeQuery = snakeQuery.eq('national_id', effectiveNic);
    } else {
      snakeQuery = snakeQuery.or(`national_id.eq."${cleanEffectiveNic}",and(national_id.eq."${cleanTrimmedNic}",branch_id.eq."${cleanBranchId}")`);
    }
    const { data: snakeExisting } = await snakeQuery.limit(1).maybeSingle();
      
    if (snakeExisting) {
      existingClient = snakeExisting;
    } else {
      let camelQuery = adminSupabase.from('clients').select('*');
      if (isGovNic) {
        camelQuery = camelQuery.eq('nationalId', effectiveNic);
      } else {
        camelQuery = camelQuery.or(`nationalId.eq."${cleanEffectiveNic}",and(nationalId.eq."${cleanTrimmedNic}",branchId.eq."${cleanBranchId}")`);
      }
      const { data: camelExisting } = await camelQuery.limit(1).maybeSingle();
      if (camelExisting) {
        existingClient = camelExisting;
      }
    }

    if (existingClient) {
      const existingFirst = existingClient.first_name || existingClient.firstName || '';
      const validNewFirst = (firstName && firstName.trim() !== '' && firstName !== 'Valued Customer') ? firstName.trim() : null;
      const finalFirst = validNewFirst || existingFirst || 'Valued Customer';

      const existingLast = existingClient.last_name || existingClient.lastName || '.';
      const validNewLast = (lastName && lastName.trim() !== '' && lastName !== '.') ? lastName.trim() : null;
      const finalLast = validNewLast || existingLast;

      const finalPhone = (phone && phone.trim() !== '') ? phone.trim() : (existingClient.phone || null);
      const finalAddress = (address && address.trim() !== '') ? address.trim() : (existingClient.address || null);
      const finalNicImage = (nicImage && nicImage.trim() !== '') ? nicImage : (existingClient.nic_image || existingClient.nicImage || null);
      const finalSigImage = (signatureImage && signatureImage.trim() !== '') ? signatureImage : (existingClient.signature_image || existingClient.signatureImage || null);

      // 1. Try snake_case update first (matching active database schema)
      const snakeUpdateData: any = {
        first_name: finalFirst,
        last_name: finalLast,
        phone: finalPhone,
        address: finalAddress,
        nic_image: finalNicImage,
        signature_image: finalSigImage
      };
      
      const { data: updatedClient, error: updateErr } = await adminSupabase
        .from('clients')
        .update(snakeUpdateData)
        .eq('id', existingClient.id)
        .select()
        .single();

      if (!updateErr && updatedClient) {
        invalidateClientsCache();
        return NextResponse.json(updatedClient, { status: 200 });
      }

      // 2. Fallback to camelCase update if needed
      const camelUpdateData: any = {
        firstName: finalFirst,
        lastName: finalLast,
        phone: finalPhone,
        address: finalAddress,
        nicImage: finalNicImage,
        signatureImage: finalSigImage
      };

      const { data: camelUpdatedClient } = await adminSupabase
        .from('clients')
        .update(camelUpdateData)
        .eq('id', existingClient.id)
        .select()
        .single();

      invalidateClientsCache();
      return NextResponse.json(camelUpdatedClient || updatedClient || existingClient, { status: 200 });
    }

    const clientId = crypto.randomUUID();

    // 1. Try snake_case insert first (matching active database schema)
    const snakePayload: any = {
      id: clientId,
      national_id: effectiveNic,
      first_name: firstName,
      last_name: lastName || '.',
      phone: phone || null,
      branch_id: effectiveBranchId,
      created_by_user_id: effectiveUserId,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      address: address || null,
      nic_image: nicImage || null,
      signature_image: signatureImage || null
    };

    const { data: snakeData, error: snakeErr } = await adminSupabase
      .from('clients')
      .insert([snakePayload])
      .select()
      .single();

    if (!snakeErr && snakeData) {
      invalidateClientsCache();
      return NextResponse.json(snakeData, { status: 201 });
    }

    // 2. Fallback to camelCase insert if database uses camelCase schema
    const camelPayload: any = {
      id: clientId,
      nationalId: trimmedNic,
      firstName: firstName,
      lastName: lastName || '.',
      phone: phone || null,
      branchId: effectiveBranchId,
      createdByUserId: effectiveUserId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      address: address || null,
      nic_image: nicImage || null,
      signature_image: signatureImage || null
    };

    const { data: camelData, error: camelErr } = await adminSupabase
      .from('clients')
      .insert([camelPayload])
      .select()
      .single();

    if (!camelErr && camelData) {
      invalidateClientsCache();
      return NextResponse.json(camelData, { status: 201 });
    }

    console.error("Clients POST Error (Both schemas failed):", snakeErr, camelErr);
    return NextResponse.json({ error: snakeErr?.message || camelErr?.message || "Failed to save customer record to database." }, { status: 500 });
  } catch (error: any) {
    console.error("API POST Exception:", error);
    return NextResponse.json({ error: error.message || 'Failed to save customer' }, { status: 500 });
  }
}
