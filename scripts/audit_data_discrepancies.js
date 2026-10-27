const path = require('path');
const { createClient } = require(path.resolve(__dirname, '../frontend/node_modules/@supabase/supabase-js'));
require(path.resolve(__dirname, '../frontend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../frontend/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log('--- COMPREHENSIVE STOCK & PAWN DATA INTEGRITY AUDIT ---');

  // 1. Fetch all stock_items
  let page = 0, pageSize = 1000, allStock = [];
  while (true) {
    const { data } = await supabase.from('stock_items').select('*').range(page * pageSize, (page + 1) * pageSize - 1);
    if (!data || data.length === 0) break;
    allStock = allStock.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`Fetched ${allStock.length} stock_items.`);

  // 2. Fetch all pawns
  page = 0;
  let allPawns = [];
  while (true) {
    const { data } = await supabase.from('pawns').select('*').range(page * pageSize, (page + 1) * pageSize - 1);
    if (!data || data.length === 0) break;
    allPawns = allPawns.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`Fetched ${allPawns.length} pawns.`);

  // 3. Fetch all stock_customers
  page = 0;
  let allCusts = [];
  while (true) {
    const { data } = await supabase.from('stock_customers').select('*').range(page * pageSize, (page + 1) * pageSize - 1);
    if (!data || data.length === 0) break;
    allCusts = allCusts.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`Fetched ${allCusts.length} stock_customers.`);

  // Audit 1: Weight discrepancies (MG vs Grams)
  console.log('\n=== AUDIT 1: WEIGHT (MG vs GRAMS) DISCREPANCIES ===');
  const tinyWeights = allStock.filter(i => parseFloat(i.weight) > 0 && parseFloat(i.weight) < 0.05);
  console.log(`Stock items with weight < 0.05g (likely entered as mg or divided by 1000 twice): ${tinyWeights.length}`);
  if (tinyWeights.length > 0) {
    console.log('Sample tiny weights (first 5):');
    tinyWeights.slice(0, 5).forEach(i => {
      console.log(`  Branch: ${i.branch_id}, Bill: ${i.bill_no}, Weight: ${i.weight}g (${parseFloat(i.weight) * 1000}mg), Price: Rs. ${i.price}`);
    });
  }

  // Cross-check stock vs pawns weights
  const weightMismatches = [];
  for (const p of allPawns) {
    const cleanPawnBill = (p.bill_no || '').replace(/^[A-Z0-9]+-/, '').trim().toLowerCase();
    if (!cleanPawnBill) continue;
    const matchedStock = allStock.find(s => 
      s.branch_id === p.branch_id && 
      s.bill_no.toLowerCase().trim() === cleanPawnBill
    );
    if (matchedStock) {
      const pWeightGrams = parseFloat(p.weight_grams) || 0;
      const sWeightGrams = parseFloat(matchedStock.weight) || 0;
      if (Math.abs(pWeightGrams - sWeightGrams) > 0.1 && pWeightGrams > 0) {
        weightMismatches.push({
          branch: p.branch_id,
          bill: cleanPawnBill,
          pawnWeightGrams: pWeightGrams,
          stockWeightGrams: sWeightGrams,
          pawnWeightMg: p.weight_mg,
          price: matchedStock.price
        });
      }
    }
  }
  console.log(`Stock vs Pawn weight discrepancies (> 0.1g mismatch): ${weightMismatches.length}`);
  if (weightMismatches.length > 0) {
    console.log('Sample weight mismatches:');
    weightMismatches.slice(0, 5).forEach(m => console.log(' ', m));
  }

  // Audit 2: Date discrepancies
  console.log('\n=== AUDIT 2: DATE DISCREPANCIES ===');
  const dateMismatches = [];
  for (const p of allPawns) {
    const cleanPawnBill = (p.bill_no || '').replace(/^[A-Z0-9]+-/, '').trim().toLowerCase();
    if (!cleanPawnBill) continue;
    const matchedStock = allStock.find(s => 
      s.branch_id === p.branch_id && 
      s.bill_no.toLowerCase().trim() === cleanPawnBill
    );
    if (matchedStock) {
      const pawnCreatedDate = p.created_at ? p.created_at.split('T')[0] : '';
      const stockDate = matchedStock.date;
      if (pawnCreatedDate && stockDate && pawnCreatedDate !== stockDate) {
        dateMismatches.push({
          branch: p.branch_id,
          bill: cleanPawnBill,
          stockDate,
          pawnCreatedDate,
          stockCreatedAt: matchedStock.created_at ? matchedStock.created_at.split('T')[0] : ''
        });
      }
    }
  }
  console.log(`Stock date vs Pawn creation date mismatches: ${dateMismatches.length}`);
  if (dateMismatches.length > 0) {
    console.log('Sample date mismatches (first 5):');
    dateMismatches.slice(0, 5).forEach(m => console.log(' ', m));
  }

  // Audit 3: Branch discrepancies
  console.log('\n=== AUDIT 3: BRANCH DISCREPANCIES ===');
  const branchMismatches = [];
  for (const p of allPawns) {
    const cleanPawnBill = (p.bill_no || '').replace(/^[A-Z0-9]+-/, '').trim().toLowerCase();
    if (!cleanPawnBill) continue;
    // Check if bill exists in stock_items under a DIFFERENT branch!
    const diffBranchStock = allStock.filter(s => 
      s.bill_no.toLowerCase().trim() === cleanPawnBill && 
      s.branch_id !== p.branch_id
    );
    if (diffBranchStock.length > 0) {
      branchMismatches.push({
        bill: cleanPawnBill,
        pawnBranch: p.branch_id,
        stockBranches: diffBranchStock.map(s => s.branch_id)
      });
    }
  }
  console.log(`Bills found in Pawns under one branch but in Stock under a DIFFERENT branch: ${branchMismatches.length}`);
  if (branchMismatches.length > 0) {
    console.log('Sample branch mismatches:');
    branchMismatches.slice(0, 5).forEach(m => console.log(' ', m));
  }

  // Audit 4: Customer vs Stock Branch discrepancies
  console.log('\n=== AUDIT 4: CUSTOMER VS STOCK BRANCH DISCREPANCIES ===');
  const custBranchMismatches = [];
  for (const c of allCusts) {
    if (!c.bill_numbers) continue;
    const cBills = c.bill_numbers.split(',').map(b => b.trim().toLowerCase());
    const cBranch = c.branch_id || c.branch;
    if (!cBranch) continue;

    for (const b of cBills) {
      const cleanB = b.replace(/^[A-Z0-9]+-/, '').trim();
      const stockItem = allStock.find(s => s.bill_no.toLowerCase().trim() === cleanB);
      if (stockItem && stockItem.branch_id && stockItem.branch_id !== cBranch) {
        custBranchMismatches.push({
          bill: cleanB,
          customerBranch: cBranch,
          customerName: c.name,
          stockBranch: stockItem.branch_id
        });
      }
    }
  }
  console.log(`Customers linked to bills where Customer Branch != Stock Branch: ${custBranchMismatches.length}`);
  if (custBranchMismatches.length > 0) {
    console.log('Sample customer/stock branch mismatches:');
    custBranchMismatches.slice(0, 5).forEach(m => console.log(' ', m));
  }
}

run().catch(console.error);
