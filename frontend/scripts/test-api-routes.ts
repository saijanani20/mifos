import { GET as getPawns } from '../src/app/api/pawns/route';
import { GET as getClients } from '../src/app/api/clients/route';
import { GET as getBranchStatus } from '../src/app/api/branch-status/route';
import { GET as getDailyLedger } from '../src/app/api/ledger/daily/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';

async function testApiRoutes() {
  console.log('========================================================================');
  console.log('               API ROUTE HANDLER FUNCTIONAL INTEGRITY TEST');
  console.log('========================================================================\n');

  // Test 1: GET /api/pawns
  try {
    const req = new Request('http://localhost:3000/api/pawns?requestedBranch=ALL');
    const res = await getPawns(req);
    const body = await res.json();
    console.log(`[API /api/pawns] Status: ${res.status} | Total returned: ${Array.isArray(body) ? body.length : (body.pawns?.length ?? 'object')}`);
  } catch (e: any) {
    console.error('[API /api/pawns] Error:', e.message);
  }

  // Test 2: GET /api/clients
  try {
    const req = new Request('http://localhost:3000/api/clients');
    const res = await getClients(req);
    const body = await res.json();
    console.log(`[API /api/clients] Status: ${res.status} | Total returned: ${Array.isArray(body) ? body.length : (body.clients?.length ?? 'object')}`);
  } catch (e: any) {
    console.error('[API /api/clients] Error:', e.message);
  }

  // Test 3: GET /api/branch-status
  try {
    const req = new Request('http://localhost:3000/api/branch-status');
    const res = await getBranchStatus(req);
    const body = await res.json();
    console.log(`[API /api/branch-status] Status: ${res.status} | Payload keys:`, Object.keys(body));
  } catch (e: any) {
    console.error('[API /api/branch-status] Error:', e.message);
  }

  // Test 4: GET /api/ledger/daily (requires branch_id & date)
  try {
    const req = new Request('http://localhost:3000/api/ledger/daily?branch_id=KTW&date=2026-10-09');
    const res = await getDailyLedger(req);
    const body = await res.json();
    console.log(`[API /api/ledger/daily] Status: ${res.status} | Ledger exists:`, !!body.ledger);
  } catch (e: any) {
    console.error('[API /api/ledger/daily] Error:', e.message);
  }

  // Test 5: GET /api/audit-logs
  try {
    const req = new Request('http://localhost:3000/api/audit-logs');
    const res = await getAuditLogs(req);
    const body = await res.json();
    console.log(`[API /api/audit-logs] Status: ${res.status} | Logs retrieved:`, Array.isArray(body) ? body.length : 'non-array');
  } catch (e: any) {
    console.error('[API /api/audit-logs] Error:', e.message);
  }

  console.log('\n========================================================================\n');
}

testApiRoutes().catch(console.error);
