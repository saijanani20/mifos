import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let adminSupabase: any;
if (supabaseUrl && supabaseKey) {
  adminSupabase = createClient(supabaseUrl, supabaseKey);
}

export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'stock_interests.json');

async function getLocalStockInterests(): Promise<any[]> {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const content = await fs.promises.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}

async function saveLocalStockInterests(data: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
    }
    await fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write local stock interests file:', e);
  }
}

// GET: Fetch interest records for a specific bill, branch, item, or all bills
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const billNo = searchParams.get('bill_no');
    const branch = searchParams.get('branch');
    const itemId = searchParams.get('item_id');

    let records: any[] = [];
    let supabaseFailed = false;

    if (adminSupabase) {
      let query = adminSupabase
        .from('stock_interests')
        .select('*')
        .order('created_at', { ascending: false });

      if (billNo) {
        query = query.eq('bill_no', billNo);
      }
      if (branch && branch.toUpperCase() !== 'ALL') {
        query = query.eq('branch', branch.toUpperCase());
      }

      const { data, error } = await query;

      if (!error && data) {
        records = data;
      } else {
        supabaseFailed = true;
      }
    } else {
      supabaseFailed = true;
    }

    if (supabaseFailed || records.length === 0) {
      const localRecords = await getLocalStockInterests();
      if (localRecords && localRecords.length > 0) {
        records = localRecords;
        if (billNo) {
          records = records.filter(r => (r.bill_no || '').trim().toUpperCase() === billNo.trim().toUpperCase());
        }
        if (branch && branch.toUpperCase() !== 'ALL') {
          records = records.filter(r => (r.branch || '').trim().toUpperCase() === branch.trim().toUpperCase());
        }
        if (itemId) {
          records = records.filter(r => !r.item_id || r.item_id === itemId);
        }
      }
    }

    return NextResponse.json({ data: records || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Add a new interest record
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bill_no, item_id, date, interest_value, branch, notes } = body;

    if (!bill_no || !date || interest_value === undefined || interest_value === null || !branch) {
      return NextResponse.json({ error: 'Missing required fields: bill_no, date, interest_value, branch' }, { status: 400 });
    }

    const numericValue = parseFloat(interest_value);
    if (isNaN(numericValue)) {
      return NextResponse.json({ error: 'Invalid interest_value' }, { status: 400 });
    }

    const cleanBranch = branch.trim().toUpperCase();
    const payload = {
      id: 'si_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      bill_no: bill_no.trim(),
      item_id: item_id || undefined,
      date: date,
      interest_value: numericValue,
      branch: cleanBranch,
      notes: notes || '',
      created_at: new Date().toISOString()
    };

    let insertedData: any = payload;
    let savedToSupabase = false;

    if (adminSupabase) {
      try {
        const { data, error } = await adminSupabase
          .from('stock_interests')
          .insert([payload])
          .select()
          .single();

        if (!error && data) {
          insertedData = data;
          savedToSupabase = true;
        }
      } catch (e) {
        savedToSupabase = false;
      }
    }

    // Always keep server-side JSON file in sync for offline/local resilience
    const localRecords = await getLocalStockInterests();
    const updated = [insertedData, ...localRecords.filter(r => r.id !== insertedData.id)];
    await saveLocalStockInterests(updated);

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache(cleanBranch, date);
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ success: true, data: insertedData, savedToSupabase });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Remove an interest record by ID
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing required param: id' }, { status: 400 });
    }

    if (adminSupabase) {
      try {
        await adminSupabase
          .from('stock_interests')
          .delete()
          .eq('id', id);
      } catch (e) {}
    }

    // Remove from local file
    const localRecords = await getLocalStockInterests();
    const updated = localRecords.filter(r => r.id !== id);
    await saveLocalStockInterests(updated);

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache('ALL');
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ success: true, message: 'Interest record deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
