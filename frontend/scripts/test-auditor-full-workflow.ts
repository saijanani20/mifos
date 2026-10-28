import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

interface StepResult {
  step: number;
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
  durationMs: number;
}

const results: StepResult[] = [];

function recordStep(step: number, name: string, status: 'PASS' | 'FAIL', details: string, durationMs: number) {
  results.push({ step, name, status, details, durationMs });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`[Step ${step.toString().padStart(2)}] ${icon} ${name.padEnd(45)} | ${status} (${durationMs}ms) -> ${details}`);
}

async function runAuditorWorkflowAudit() {
  console.log('\n========================================================================================');
  console.log('              AUDITOR DASHBOARD & VERIFICATION END-TO-END WORKFLOW TEST');
  console.log('========================================================================================\n');

  let auditorToken = '';
  let managerToken = '';
  let testPawnId = '';
  let testBillNo = '';

  // ------------------------------------------------------------------------------------------
  // STEP 1: Auditor Authentication via /api/auth/login
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'auditor@gmail.com', password: 'auditor123' })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      if (res.status === 200 && data.token && data.user?.role === 'AUDITOR') {
        auditorToken = data.token;
        recordStep(1, 'Auditor Login Authentication', 'PASS', `Logged in as ${data.user.email} (Role: ${data.user.role})`, duration);
      } else {
        recordStep(1, 'Auditor Login Authentication', 'FAIL', `Status ${res.status}: ${data.error || 'Token missing'}`, duration);
      }
    } catch (e: any) {
      recordStep(1, 'Auditor Login Authentication', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 2: Manager Authentication via /api/auth/login
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'manager@gmail.com', password: 'manager123' })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      if (res.status === 200 && data.token && data.user?.role === 'MANAGER') {
        managerToken = data.token;
        recordStep(2, 'Manager Login Authentication', 'PASS', `Logged in as ${data.user.email} (Role: ${data.user.role})`, duration);
      } else {
        recordStep(2, 'Manager Login Authentication', 'FAIL', `Status ${res.status}: ${data.error || 'Token missing'}`, duration);
      }
    } catch (e: any) {
      recordStep(2, 'Manager Login Authentication', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 3: Auditor Dashboard - Cross-Branch Transactions Query
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns?filterBranch=ALL&role=AUDITOR`, {
        headers: {
          'Authorization': `Bearer ${auditorToken}`,
          'x-branch-id': 'HQ'
        }
      });
      const pawns = await res.json();
      const duration = Date.now() - start;

      if (res.status === 200 && Array.isArray(pawns)) {
        const branches = new Set(pawns.map((p: any) => p.branch_id));
        recordStep(3, 'Auditor Pawn Tickets Query (ALL)', 'PASS', `Retrieved ${pawns.length} contracts across ${branches.size} branches`, duration);
      } else {
        recordStep(3, 'Auditor Pawn Tickets Query (ALL)', 'FAIL', `Status: ${res.status}`, duration);
      }
    } catch (e: any) {
      recordStep(3, 'Auditor Pawn Tickets Query (ALL)', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 4: Auditor Dashboard - Audit Activity Logs Query
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/audit-logs?action=AUDIT_&branchId=ALL`, {
        headers: {
          'Authorization': `Bearer ${auditorToken}`,
          'x-branch-id': 'HQ'
        }
      });
      const data = await res.json();
      const duration = Date.now() - start;

      if (res.status === 200) {
        const logs = data.logs || (Array.isArray(data) ? data : []);
        recordStep(4, 'Audit Activity Logs Query', 'PASS', `Retrieved ${logs.length} previous audit trail logs`, duration);
      } else {
        recordStep(4, 'Audit Activity Logs Query', 'FAIL', `Status: ${res.status}`, duration);
      }
    } catch (e: any) {
      recordStep(4, 'Audit Activity Logs Query', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 5: Vault Inventory & Redis L1 Cache Layer Check
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(`${BASE_URL}/api/stock/daily-matrix?date=${today}&branch=ALL`, {
        headers: {
          'Authorization': `Bearer ${auditorToken}`
        }
      });
      const matrix = await res.json();
      const duration = Date.now() - start;
      const cacheHeader = res.headers.get('X-Cache');

      if (res.status === 200 && matrix.summary) {
        recordStep(5, 'Vault Inventory Daily Matrix & Redis Cache', 'PASS', `Item count: ${matrix.summary.item_count ?? 0} | Cache Header: ${cacheHeader || 'Standard'}`, duration);
      } else {
        recordStep(5, 'Vault Inventory Daily Matrix & Redis Cache', 'FAIL', `Status: ${res.status}`, duration);
      }
    } catch (e: any) {
      recordStep(5, 'Vault Inventory Daily Matrix & Redis Cache', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 6: Auditor Force-Expire Redis Cache Action
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(`${BASE_URL}/api/stock/cache/invalidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auditorToken}`
        },
        body: JSON.stringify({ branch: 'ALL', date: today })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      if (res.status === 200 && data.success) {
        recordStep(6, 'Auditor Force-Expire Redis Cache', 'PASS', `Invalidated cache keys: ${data.invalidatedKeys?.length ?? 1}`, duration);
      } else {
        recordStep(6, 'Auditor Force-Expire Redis Cache', 'FAIL', data.error || `Status ${res.status}`, duration);
      }
    } catch (e: any) {
      recordStep(6, 'Auditor Force-Expire Redis Cache', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 7: Create Isolated Test Pawn Ticket for Workflow Audit
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      testBillNo = `AUD-TEST-${Date.now().toString().slice(-4)}`;
      testPawnId = crypto.randomUUID();

      // Find an existing profile for created_by_user_id
      const { data: userProfile } = await adminSupabase.from('profiles').select('id').limit(1).single();
      // Find an existing client
      const { data: client } = await adminSupabase.from('clients').select('id').limit(1).single();

      if (!userProfile?.id || !client?.id) {
        throw new Error('Required user profile or client not found in database to create test pawn');
      }

      const { data: newPawn, error: pErr } = await adminSupabase.from('pawns').insert([{
        id: testPawnId,
        bill_no: testBillNo,
        client_id: client.id,
        created_by_user_id: userProfile.id,
        branch_id: 'KHT',
        disbursed_amount: 50000,
        appraised_value: 80000,
        interest_rate: 3.5,
        period_months: 3,
        weight_grams: 12.5,
        weight_mg: 12500,
        status: 'PENDING_APPROVAL',
        description: 'Gold Sovereign Bangle 22K'
      }]).select().single();

      if (pErr || !newPawn) {
        throw new Error(pErr?.message || 'Failed to create test pawn');
      }

      // Add item details
      await adminSupabase.from('pawn_items').insert([{
        id: crypto.randomUUID(),
        pawn_id: testPawnId,
        item_type: 'Gold Bangle',
        description: '22K Solid Gold Bangle',
        weight_grams: 12.5,
        weight_mg: 12500,
        appraised_value: 80000
      }]);

      // Add scale evaluation evidence in rejected_evaluations
      await adminSupabase.from('rejected_evaluations').insert([{
        id: crypto.randomUUID(),
        status: `BILL:${testBillNo}`,
        air_weight: 12500,
        water_weight: 11800,
        specific_gravity: 19.3,
        estimated_karat: '22K',
        air_weight_photo_url: 'https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?w=400',
        water_weight_photo_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=400',
        asking_amount: 50000,
        true_value: 80000
      }]);

      recordStep(7, 'Create Test Pawn Contract', 'PASS', `Created Pawn Ticket #${testBillNo} (ID: ${testPawnId}) with status PENDING_APPROVAL and scale proofs`, Date.now() - start);
    } catch (e: any) {
      recordStep(7, 'Create Test Pawn Contract', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 8: Auditor Verification Dossier Query via /api/pawns/[id]
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns/${testPawnId}`, {
        headers: {
          'Authorization': `Bearer ${auditorToken}`
        }
      });
      const dossier = await res.json();
      const duration = Date.now() - start;

      const hasPawn = !!dossier.pawn;
      const hasClient = !!dossier.client;
      const hasItems = Array.isArray(dossier.items);
      const hasEvidence = !!dossier.evaluationEvidence;

      if (res.status === 200 && hasPawn && hasClient && hasItems && hasEvidence) {
        recordStep(8, 'Auditor Verification Dossier Query', 'PASS', `Dossier loaded with Customer, Collateral (${dossier.items.length} items), Scale Photos, Specific Gravity`, duration);
      } else {
        recordStep(8, 'Auditor Verification Dossier Query', 'FAIL', `Missing dossier components. Status: ${res.status}`, duration);
      }
    } catch (e: any) {
      recordStep(8, 'Auditor Verification Dossier Query', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 9: Auditor Quick Observation Logging via /api/audit-logs
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/audit-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auditorToken}`
        },
        body: JSON.stringify({
          action: 'AUDIT_VERIFIED',
          resource: testBillNo,
          bill_no: testBillNo,
          branch_id: 'KHT',
          details: {
            bill_no: testBillNo,
            pawn_id: testPawnId,
            status: 'PASSED',
            notes: 'Preliminary physical check passed. Scale calibrated.',
            disbursed_amount: 50000,
            audited_at: new Date().toISOString(),
            auditor_email: 'auditor@gmail.com'
          }
        })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      if (res.status === 200) {
        recordStep(9, 'Auditor Quick Observation Log Persistence', 'PASS', `Logged AUDIT_VERIFIED event for #${testBillNo}`, duration);
      } else {
        recordStep(9, 'Auditor Quick Observation Log Persistence', 'FAIL', data.error || `Status ${res.status}`, duration);
      }
    } catch (e: any) {
      recordStep(9, 'Auditor Quick Observation Log Persistence', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 10: Auditor Raises Discrepancy Issue via /api/pawns/[id]/issue
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns/${testPawnId}/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auditorToken}`
        },
        body: JSON.stringify({
          category: 'Weight',
          note: 'Observed weight on scale is 10.2g, but contract declaration indicates 12.5g. Discrepancy of 2.3g detected.',
          details: {
            observedWeight: 10.2,
            observedKarat: '22K'
          }
        })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      // Verify DB status changed to REQUIRES_RECHECK
      const { data: updatedPawn } = await adminSupabase.from('pawns').select('status').eq('id', testPawnId).single();

      if (res.status === 200 && data.success && updatedPawn?.status === 'REQUIRES_RECHECK') {
        recordStep(10, 'Auditor Raise Discrepancy Issue', 'PASS', `Ticket status correctly updated to REQUIRES_RECHECK and issue recorded`, duration);
      } else {
        recordStep(10, 'Auditor Raise Discrepancy Issue', 'FAIL', data.error || `Status ${res.status}, DB Status: ${updatedPawn?.status}`, duration);
      }
    } catch (e: any) {
      recordStep(10, 'Auditor Raise Discrepancy Issue', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 11: Security Gate Check: Manager Approval MUST BE BLOCKED when Issue is Active
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns/${testPawnId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${managerToken}`
        },
        body: JSON.stringify({ approvedBy: 'Branch Manager' })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      // Must be 409 Conflict because status is REQUIRES_RECHECK
      if (res.status === 409) {
        recordStep(11, 'Manager Approval Gate Enforcement', 'PASS', `Correctly blocked Manager approval with 409 Conflict: "${data.error}"`, duration);
      } else {
        recordStep(11, 'Manager Approval Gate Enforcement', 'FAIL', `Expected 409 Conflict, received status ${res.status}: ${JSON.stringify(data)}`, duration);
      }
    } catch (e: any) {
      recordStep(11, 'Manager Approval Gate Enforcement', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 12: Security Gate Check: Auditor Approval MUST BE BLOCKED when Issue is Active
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns/${testPawnId}/auditor-approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auditorToken}`
        },
        body: JSON.stringify({
          checklist: { physicalExists: true, itemMatches: true, weightMatches: false },
          notes: 'Attempting approval while issue is open',
          confirmed: true
        })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      if (res.status === 409) {
        recordStep(12, 'Auditor Self-Approval Gate Enforcement', 'PASS', `Correctly blocked Auditor approval with 409 Conflict: "${data.error}"`, duration);
      } else {
        recordStep(12, 'Auditor Self-Approval Gate Enforcement', 'FAIL', `Expected 409 Conflict, received status ${res.status}: ${JSON.stringify(data)}`, duration);
      }
    } catch (e: any) {
      recordStep(12, 'Auditor Self-Approval Gate Enforcement', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 13: Staff Resolution & Status Reset to PENDING_APPROVAL
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      // Simulate branch cashier adjusting declared contract weight to actual verified 10.2g and resolving issue
      await adminSupabase.from('pawns').update({
        weight_grams: 10.2,
        weight_mg: 10200,
        status: 'PENDING_APPROVAL'
      }).eq('id', testPawnId);

      // Mark the audit issue as resolved
      const { data: issueLogs } = await adminSupabase
        .from('audit_logs')
        .select('*')
        .eq('resource', testBillNo)
        .eq('action', 'AUDIT_ISSUE_RAISED');

      if (issueLogs) {
        for (const log of issueLogs) {
          const updatedDetails = { ...log.details, resolved: true, status: 'RESOLVED' };
          await adminSupabase.from('audit_logs').update({ details: updatedDetails }).eq('id', log.id);
        }
      }

      recordStep(13, 'Staff Issue Rectification & Resolution', 'PASS', `Weight rectified to 10.2g, issue resolved, ticket returned to PENDING_APPROVAL`, Date.now() - start);
    } catch (e: any) {
      recordStep(13, 'Staff Issue Rectification & Resolution', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 14: Auditor Full Physical Verification & Final Auditor Approval
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns/${testPawnId}/auditor-approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auditorToken}`
        },
        body: JSON.stringify({
          checklist: {
            physicalExists: true,
            itemMatches: true,
            weightMatches: true,
            karatMatches: true,
            descriptionMatches: true,
            quantityMatches: true,
            observedWeight: 10.2,
            observedKarat: '22K',
            stockVerified: true,
            cashVerified: true
          },
          notes: 'Rectified weight re-inspected against digital scale. Gold acid and density test confirm 22K. Physical item verified in vault.',
          confirmed: true
        })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      const { data: updatedPawn } = await adminSupabase.from('pawns').select('status').eq('id', testPawnId).single();

      if (res.status === 200 && data.success && updatedPawn?.status === 'AUDITED_PENDING_APPROVAL') {
        recordStep(14, 'Auditor Approval Submission', 'PASS', `Ticket status successfully changed to AUDITED_PENDING_APPROVAL with full checklist certified`, duration);
      } else {
        recordStep(14, 'Auditor Approval Submission', 'FAIL', data.error || `Status ${res.status}, DB Status: ${updatedPawn?.status}`, duration);
      }
    } catch (e: any) {
      recordStep(14, 'Auditor Approval Submission', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 15: Manager Dual-Control Final Approval & Automated GL Double-Entry
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/pawns/${testPawnId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${managerToken}`
        },
        body: JSON.stringify({ approvedBy: 'Branch Manager' })
      });
      const data = await res.json();
      const duration = Date.now() - start;

      const { data: finalPawn } = await adminSupabase.from('pawns').select('status, approved_by').eq('id', testPawnId).single();
      const { data: jeLines } = await adminSupabase.from('journal_entry_line').select('*').eq('journal_entry_id', data.journalEntryId);

      const hasDebitCredit = (jeLines || []).some((l: any) => l.debit > 0) && (jeLines || []).some((l: any) => l.credit > 0);

      if (res.status === 200 && data.success && finalPawn?.status === 'ACTIVE' && hasDebitCredit) {
        recordStep(15, 'Manager Final Approval & GL Posting', 'PASS', `Ticket approved to ACTIVE. Automated General Ledger entries posted (JE: ${data.journalEntryId})`, duration);
      } else {
        recordStep(15, 'Manager Final Approval & GL Posting', 'FAIL', data.error || `Status: ${res.status}, DB: ${finalPawn?.status}`, duration);
      }
    } catch (e: any) {
      recordStep(15, 'Manager Final Approval & GL Posting', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // STEP 16: Immutable Audit Trail Completeness Verification
  // ------------------------------------------------------------------------------------------
  {
    const start = Date.now();
    try {
      const { data: logs, error: lErr } = await adminSupabase
        .from('audit_logs')
        .select('action, user_email, role, created_at')
        .eq('resource', testBillNo)
        .order('created_at', { ascending: true });

      const actions = (logs || []).map((l: any) => l.action);
      const hasAuditorApprove = actions.includes('AUDITOR_APPROVED');
      const hasManagerApprove = actions.includes('MANAGER_APPROVED');

      if (!lErr && hasAuditorApprove && hasManagerApprove) {
        recordStep(16, 'Immutable Audit Trail Verification', 'PASS', `Full lifecycle preserved: [${actions.join(' -> ')}]`, Date.now() - start);
      } else {
        recordStep(16, 'Immutable Audit Trail Verification', 'FAIL', `Actions found: ${actions.join(', ')}`, Date.now() - start);
      }
    } catch (e: any) {
      recordStep(16, 'Immutable Audit Trail Verification', 'FAIL', e.message, Date.now() - start);
    }
  }

  // ------------------------------------------------------------------------------------------
  // CLEANUP TEST RECORD
  // ------------------------------------------------------------------------------------------
  try {
    if (testPawnId) {
      await adminSupabase.from('pawn_items').delete().eq('pawn_id', testPawnId);
      await adminSupabase.from('rejected_evaluations').delete().eq('status', `BILL:${testBillNo}`);
      await adminSupabase.from('pawns').delete().eq('id', testPawnId);
      await adminSupabase.from('audit_logs').delete().eq('resource', testBillNo);
      console.log(`\n[Cleanup] Test pawn ${testBillNo} and associated logs safely cleaned up.`);
    }
  } catch (err) {
    console.warn('[Cleanup Warning]:', err);
  }

  // ------------------------------------------------------------------------------------------
  // SUMMARY REPORT
  // ------------------------------------------------------------------------------------------
  console.log('\n========================================================================================');
  console.log('                            AUDITOR WORKFLOW AUDIT SUMMARY');
  console.log('========================================================================================');
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const pct = ((passed / total) * 100).toFixed(1);

  console.log(`Total Verification Steps: ${total}`);
  console.log(`Passed:                   ${passed} (${pct}%)`);
  console.log(`Failed:                   ${failed}`);
  console.log('========================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditorWorkflowAudit();
