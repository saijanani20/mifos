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

function hasBranchPrefix(billNo) {
  if (!billNo) return null;
  const clean = billNo.trim();
  const match = clean.match(/^([A-Za-z0-9]{2,4})[-/_]\s*(.+)$/);
  if (match && BRANCH_CODES.includes(match[1].toUpperCase())) {
    return { prefix: match[1].toUpperCase(), cleanBill: match[2].trim(), original: clean };
  }
  return null;
}

async function run() {
  let allItems = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('stock_items').select('id, bill_no, branch_id').range(from, from + 999);
    if (!data || data.length === 0) break;
    allItems.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log('Total stock_items in DB:', allItems.length);

  const prefixed = [];
  for (const item of allItems) {
    const info = hasBranchPrefix(item.bill_no);
    if (info) {
      prefixed.push({ id: item.id, ...info, branch_id: item.branch_id });
    }
  }

  console.log(`Found ${prefixed.length} items with branch prefix in bill_no:`);
  console.log('Sample (first 20):');
  prefixed.slice(0, 20).forEach(p => {
    console.log(`  ID: ${p.id} | Original: "${p.original}" -> Clean: "${p.cleanBill}" | item.branch_id: "${p.branch_id}"`);
  });

  // Also check stock_customers!
  let allCust = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('stock_customers').select('id, name, bill_numbers').range(from, from + 999);
    if (!data || data.length === 0) break;
    allCust.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('\nTotal stock_customers in DB:', allCust.length);
  const custPrefixed = [];
  for (const c of allCust) {
    if (!c.bill_numbers) continue;
    const bills = c.bill_numbers.split(',').map(b => b.trim()).filter(Boolean);
    const hasAnyPrefix = bills.some(b => hasBranchPrefix(b));
    if (hasAnyPrefix) {
      custPrefixed.push({ id: c.id, name: c.name, original: c.bill_numbers });
    }
  }
  console.log(`Found ${custPrefixed.length} stock_customers with branch prefix in bill_numbers.`);
  console.log('Sample stock_customers with prefix:');
  custPrefixed.slice(0, 10).forEach(c => {
    console.log(`  Cust ID: ${c.id} | Name: "${c.name}" | Bills: "${c.original}"`);
  });

  // Check pawns
  let allPawns = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('pawns').select('id, bill_no, branch_id').range(from, from + 999);
    if (!data || data.length === 0) break;
    allPawns.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const pawnsPrefixed = [];
  for (const p of allPawns) {
    const info = hasBranchPrefix(p.bill_no);
    if (info) pawnsPrefixed.push({ id: p.id, ...info, branch_id: p.branch_id });
  }
  console.log(`\nTotal pawns: ${allPawns.length}, Prefixed: ${pawnsPrefixed.length}`);
  pawnsPrefixed.slice(0, 10).forEach(p => console.log(`  Pawn ID: ${p.id} | Original: "${p.original}" -> Clean: "${p.cleanBill}"`));
}

run().catch(console.error);
