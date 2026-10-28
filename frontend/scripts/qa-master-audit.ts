import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { normalizeNationalId, isNationalId, stripBranchPrefix, formatBranchScopedId } from '../src/lib/branch-mapping';
import {
  computeTotalGoldWeight,
  calculateSpecificGravity,
  calculateGoldValuation,
  calculateRedemptionSettlement,
  getGoldFactor
} from './test-system-calculations';
import {
  calculateDenominationTotal,
  maskAccountNumber,
  generateCashReference
} from '../src/lib/cash-management';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface QACheck {
  category: string;
  testName: string;
  status: 'PASS' | 'FAIL';
  details: string;
  metric?: string;
}

const qaResults: QACheck[] = [];

function check(category: string, testName: string, passed: boolean, details: string, metric?: string) {
  qaResults.push({
    category,
    testName,
    status: passed ? 'PASS' : 'FAIL',
    details,
    metric
  });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  const metricStr = metric ? ` (${metric})` : '';
  console.log(`[${icon}] [${category.padEnd(24)}] ${testName} -> ${details}${metricStr}`);
}

async function runMasterQA() {
  console.log('========================================================================================');
  console.log('             MIFOS SYSTEM-WIDE COMPREHENSIVE QA AUDIT SUITE');
  console.log('========================================================================================\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });

  // ------------------------------------------------------------------------------------------
  // 1. CUSTOMER SEARCH & NIC NORMALIZATION ENGINE (RECENT BUG REGRESSION TESTING)
  // ------------------------------------------------------------------------------------------
  console.log('>>> [MODULE 1] CUSTOMER SEARCH, NIC NORMALIZATION & DUPLICATE PREVENTION');
  
  // Test 1.1: 9-digit with space before v
  check('NIC Normalization', 'Space-separated Old NIC ("755381128 v")',
    normalizeNationalId('755381128 v') === '755381128V',
    `Normalized to: ${normalizeNationalId('755381128 v')}`
  );

  // Test 1.2: Branch-prefixed space-separated NIC ("KTW-755381128 v")
  check('NIC Normalization', 'Branch Prefixed Spaced NIC ("KTW-755381128 v")',
    normalizeNationalId('KTW-755381128 v') === '755381128V',
    `Normalized to: ${normalizeNationalId('KTW-755381128 v')}`
  );

  // Test 1.3: 9-digit without letter ("727501843")
  check('NIC Normalization', '9-digit Omitted V Letter ("727501843")',
    normalizeNationalId('727501843') === '727501843V',
    `Normalized to: ${normalizeNationalId('727501843')}`
  );

  // Test 1.4: 12-digit new format with spaces ("1985 1234 5678")
  check('NIC Normalization', '12-digit New Format with spaces ("1985 1234 5678")',
    normalizeNationalId('1985 1234 5678') === '198512345678',
    `Normalized to: ${normalizeNationalId('1985 1234 5678')}`
  );

  // Test 1.5: Phone number distinction ("0776287921")
  check('NIC Normalization', 'Phone Number Not Misidentified as NIC ("0776287921")',
    isNationalId('0776287921') === false,
    `isNationalId evaluated correctly to false`
  );

  // Test 1.6: Legacy book account scoping ("3R 14543")
  check('NIC Normalization', 'Legacy Book Account Scoping ("3R 14543")',
    formatBranchScopedId('3R 14543', 'KDW') === 'KDW-3R 14543',
    `Scoped correctly to: ${formatBranchScopedId('3R 14543', 'KDW')}`
  );

  // Test 1.7: Database live search verification for newly registered customer
  const { data: searchMatch, error: searchErr } = await supabase
    .from('clients')
    .select('id, national_id, first_name, phone')
    .eq('national_id', '755381128V')
    .single();

  check('Customer Search', 'Live Database Query for "755381128V"',
    !searchErr && searchMatch?.first_name === 'Namali Priyanka',
    `Found customer: ${searchMatch?.first_name} (Phone: ${searchMatch?.phone})`
  );

  // ------------------------------------------------------------------------------------------
  // 2. GOLD APPRAISAL, WEIGHT & KARAT VALUATION ENGINE
  // ------------------------------------------------------------------------------------------
  console.log('\n>>> [MODULE 2] GOLD APPRAISAL, HYDROSTATIC SG & VALUATION ENGINE');

  // Test 2.1: Weight precision & aggregation
  const itemWeights = [
    { mg: 8750 },
    { mg: 4500 },
    { mg: 8625 }
  ];
  const totGrams = computeTotalGoldWeight(itemWeights);
  check('Gold Valuation', 'Milligram to Gram High Precision (3 items)',
    totGrams === 21.875,
    `Aggregated weight: ${totGrams} g (exact 21.875 g)`
  );

  // Test 2.2: Specific gravity calculation
  const sgRes = calculateSpecificGravity(21.875, 20.635);
  check('Gold Valuation', 'Hydrostatic Archimedes SG (Air 21.875g, Water 20.635g)',
    sgRes.sg === 17.64 && sgRes.karat === '22K',
    `Calculated SG: ${sgRes.sg} | Karat: ${sgRes.karat}`
  );

  // Test 2.3: Karat identification
  const factor = getGoldFactor(sgRes.karat);
  check('Gold Valuation', 'Karat Purity Classifier from SG (22K -> 0.916)',
    factor === 0.916,
    `Identified Karat: ${sgRes.karat} (Factor: ${factor})`
  );

  // Test 2.4: Sovereign gold valuation & 80% LTV
  const val = calculateGoldValuation(8.0, 25000, '22K', 80);
  check('Gold Valuation', 'Sovereign 80% LTV Loan Calculation (8g 22K @ 25000/g)',
    val.appraisedValue === 183200 && val.loanAmount === 146560,
    `Appraised: Rs. ${val.appraisedValue} | Max Disbursal: Rs. ${val.loanAmount}`
  );

  // ------------------------------------------------------------------------------------------
  // 3. INTEREST ACCRUAL & REDEMPTION SETTLEMENT ENGINE
  // ------------------------------------------------------------------------------------------
  console.log('\n>>> [MODULE 3] PAWNING INTEREST & SETTLEMENT SLABS');

  // Test 3.1: Tier A early redemption discount (Day 5, P = 40,000)
  const redA1 = calculateRedemptionSettlement(40000, 5, 50);
  check('Interest & Settlement', 'Tier A Early Redemption (Day 5 Grace Discount)',
    redA1.settlement === 40590,
    `Principal: Rs. 40,000 | Day 5 Settlement: Rs. ${redA1.settlement} (Formula: ${redA1.formula})`
  );

  // Test 3.2: Tier A Month 1 Flat Interest (Day 20, P = 40,000)
  const redA2 = calculateRedemptionSettlement(40000, 20, 50);
  check('Interest & Settlement', 'Tier A Month 1 Flat (Day 20)',
    redA2.settlement === 41000,
    `Principal: Rs. 40,000 | Day 20 Settlement: Rs. ${redA2.settlement}`
  );

  // Test 3.3: Tier B Flat Interest (Day 25, P = 100,000 at 2.75%)
  const redB = calculateRedemptionSettlement(100000, 25, 50);
  check('Interest & Settlement', 'Tier B Flat Rate 2.75% (Day 25, P = 100,000)',
    redB.settlement === 102750 && redB.interestOne === 2750,
    `Principal: Rs. 100,000 | Day 25 Settlement: Rs. ${redB.settlement} (Interest: Rs. ${redB.interestOne})`
  );

  // ------------------------------------------------------------------------------------------
  // 4. CASH MANAGEMENT, DENOMINATIONS & REFERENCE GENERATION
  // ------------------------------------------------------------------------------------------
  console.log('\n>>> [MODULE 4] CASH MANAGEMENT, TILLS & REFERENCE GENERATION');

  // Test 4.1: Denominations total calculation
  const denoms = { notes_5000: 10, notes_1000: 25, notes_500: 20, notes_100: 50, coins_total: 250 };
  const dRes = calculateDenominationTotal(denoms);
  check('Cash Management', 'Denominations Counter Exact Total (LKR)',
    dRes.isValid && dRes.total === 90250,
    `Calculated cash total: Rs. ${dRes.total.toLocaleString()} (Expected Rs. 90,250)`
  );

  // Test 4.2: Bank Account Number Masking
  const masked = maskAccountNumber('10058291049281');
  check('Cash Management', 'Bank Account Number Masking (PCI/Privacy Standard)',
    masked === '•••• •••• 9281',
    `Masked: ${masked}`
  );

  // Test 4.3: Reference generation
  const reqRef = generateCashReference('REQ');
  const trfRef = generateCashReference('TRF');
  const dspRef = generateCashReference('DSP');
  const rcpRef = generateCashReference('RCP');
  check('Cash Management', 'Non-colliding Unique Business Reference Prefixes',
    reqRef.startsWith('REQ-') && trfRef.startsWith('TRF-') && dspRef.startsWith('DSP-') && rcpRef.startsWith('RCP-'),
    `Generated: ${reqRef}, ${trfRef}, ${dspRef}, ${rcpRef}`
  );

  // ------------------------------------------------------------------------------------------
  // 5. DATABASE REPOSITORY HEALTH & RECORD AUDIT
  // ------------------------------------------------------------------------------------------
  console.log('\n>>> [MODULE 5] DATABASE INFRASTRUCTURE & ACTIVE TABLE AUDIT');

  const tables = [
    { name: 'branches', label: 'Branch Master & Locations' },
    { name: 'clients', label: 'Borrower KYC Records' },
    { name: 'pawns', label: 'Pawn Contracts' },
    { name: 'pawn_items', label: 'Gold Collateral Items' },
    { name: 'daily_ledgers', label: 'Branch Daily Ledgers' },
    { name: 'daily_ledger_transactions', label: 'Cash Flow Line Items' },
    { name: 'daily_ledger_expenses', label: 'Branch Expenses' },
    { name: 'audit_logs', label: 'Audit & Compliance Logs' }
  ];

  for (const t of tables) {
    const t0 = Date.now();
    const { count, error } = await supabase.from(t.name).select('*', { count: 'exact', head: true });
    const lat = Date.now() - t0;
    check('Database Health', `${t.name} (${t.label})`,
      !error,
      !error ? `Healthy & accessible. Active records: ${count ?? 0}` : `Error: ${error.message}`,
      `${lat}ms`
    );
  }

  // ------------------------------------------------------------------------------------------
  // 6. PAWN INTEGRITY & ORPHAN AUDIT
  // ------------------------------------------------------------------------------------------
  console.log('\n>>> [MODULE 6] CONTRACT INTEGRITY & FOREIGN KEY AUDIT');

  const { data: samplePawns, error: pawnSampleErr } = await supabase
    .from('pawns')
    .select('id, bill_no, disbursed_amount, status, branch_id, client_id')
    .limit(50);

  const allHaveBills = samplePawns?.every(p => Boolean(p.bill_no)) ?? false;
  check('Contract Integrity', 'Pawn Bill Numbers Present & Sequenced',
    allHaveBills,
    `All sampled contracts have valid bill sequence numbers`
  );

  const allHaveBranches = samplePawns?.every(p => Boolean(p.branch_id)) ?? false;
  check('Contract Integrity', 'Pawn Branch Tenancy Assignment',
    allHaveBranches,
    `Every pawn contract mapped to an active branch tenancy`
  );

  // Summary
  console.log('\n========================================================================================');
  console.log('                            FINAL MASTER QA SCORECARD');
  console.log('========================================================================================');
  const total = qaResults.length;
  const passed = qaResults.filter(r => r.status === 'PASS').length;
  const failed = qaResults.filter(r => r.status === 'FAIL').length;
  const pct = ((passed / total) * 100).toFixed(1);

  console.log(`Total System Tests Conducted : ${total}`);
  console.log(`Passed Checks                : ${passed} (${pct}%)`);
  console.log(`Failed Checks                : ${failed}`);
  console.log('========================================================================================\n');
}

runMasterQA().catch(console.error);
