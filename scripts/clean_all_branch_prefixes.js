const fs = require('fs');
const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: ['d:/Mifos/frontend'] }));

const envFile = fs.readFileSync('d:/Mifos/frontend/.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BRANCH_CODES = ['KDW', 'KIR', 'PND', 'KHT', 'DMT', 'BRL', 'KTW', 'KOT', 'HMG', 'W2', 'W3', 'W4', 'DHW', 'HQ', 'TEST'];

function stripBranchPrefix(idOrBill) {
  if (!idOrBill) return '';
  const clean = idOrBill.trim();
  const prefixMatch = clean.match(/^([A-Za-z0-9]{2,4})[-/_]\s*(.+)$/);
  if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
    const candidateCode = prefixMatch[1].toUpperCase();
    if (BRANCH_CODES.includes(candidateCode)) {
      return prefixMatch[2].trim();
    }
  }
  return clean;
}

async function run() {
  console.log('=== CLEANING BRANCH PREFIXES FROM DATABASE ===');

  // 1. Clean stock_items
  let allItems = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('stock_items').select('id, bill_no, branch_id').range(from, from + 999);
    if (!data || data.length === 0) break;
    allItems.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  let stockUpdated = 0;
  for (const item of allItems) {
    if (!item.bill_no) continue;
    const clean = stripBranchPrefix(item.bill_no);
    if (clean !== item.bill_no.trim()) {
      const { error } = await supabase
        .from('stock_items')
        .update({ bill_no: clean })
        .eq('id', item.id);

      if (error) {
        console.error(`Failed to update stock_item ${item.id}:`, error.message);
      } else {
        stockUpdated++;
        if (stockUpdated <= 10 || stockUpdated % 20 === 0) {
          console.log(`[stock_items] Updated "${item.bill_no}" -> "${clean}" (branch: ${item.branch_id})`);
        }
      }
    }
  }
  console.log(`✔ Completed stock_items: Updated ${stockUpdated} items.`);

  // 2. Clean stock_customers
  let allCust = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('stock_customers').select('id, name, bill_numbers').range(from, from + 999);
    if (!data || data.length === 0) break;
    allCust.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  let custUpdated = 0;
  for (const c of allCust) {
    if (!c.bill_numbers) continue;
    const rawBills = c.bill_numbers.split(',').map(b => b.trim()).filter(Boolean);
    const cleanBills = rawBills.map(b => stripBranchPrefix(b));
    const newBillsStr = cleanBills.join(', ');
    if (newBillsStr !== c.bill_numbers.trim()) {
      const { error } = await supabase
        .from('stock_customers')
        .update({ bill_numbers: newBillsStr })
        .eq('id', c.id);

      if (error) {
        console.error(`Failed to update stock_customer ${c.id}:`, error.message);
      } else {
        custUpdated++;
        console.log(`[stock_customers] Updated "${c.bill_numbers}" -> "${newBillsStr}"`);
      }
    }
  }
  console.log(`✔ Completed stock_customers: Updated ${custUpdated} records.`);

  // 3. Clean pawns
  let allPawns = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('pawns').select('id, bill_no, branch_id').range(from, from + 999);
    if (!data || data.length === 0) break;
    allPawns.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  let pawnsUpdated = 0;
  for (const p of allPawns) {
    if (!p.bill_no) continue;
    const clean = stripBranchPrefix(p.bill_no);
    if (clean !== p.bill_no.trim()) {
      const { error } = await supabase
        .from('pawns')
        .update({ bill_no: clean })
        .eq('id', p.id);

      if (error) {
        console.error(`Failed to update pawn ${p.id}:`, error.message);
      } else {
        pawnsUpdated++;
        if (pawnsUpdated <= 10 || pawnsUpdated % 20 === 0) {
          console.log(`[pawns] Updated "${p.bill_no}" -> "${clean}" (branch: ${p.branch_id})`);
        }
      }
    }
  }
  console.log(`✔ Completed pawns: Updated ${pawnsUpdated} records.`);

  console.log('\n=== ALL DATABASE BILL PREFIXES CLEANED SUCCESSFULLY ===');
}

run().catch(console.error);
