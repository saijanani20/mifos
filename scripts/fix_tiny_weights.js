const path = require('path');
const { createClient } = require(path.resolve(__dirname, '../frontend/node_modules/@supabase/supabase-js'));
require(path.resolve(__dirname, '../frontend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../frontend/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixTinyWeights() {
  console.log("=== FIXING CORRUPTED TINY WEIGHTS IN STOCK_ITEMS ===");

  // Fetch all stock_items with weight > 0 and weight < 0.08 and price >= 500
  // In gold pawning, no gold item is 0.001g (1mg) with price Rs. 15,000! 
  // It happened because weight was entered as 1.5 (grams), then converted to mg as 1.5mg, then divided by 1000 = 0.0015g.
  const { data: items, error } = await supabase
    .from('stock_items')
    .select('id, bill_no, branch_id, weight, price, date, item_type')
    .gt('weight', 0)
    .lt('weight', 0.08);

  if (error) {
    console.error("Error fetching stock items:", error);
    return;
  }

  console.log(`Found ${items.length} items with weight < 0.08g:`);
  let fixedCount = 0;

  for (const item of items) {
    const oldWeight = parseFloat(item.weight);
    // Multiply by 1000 to restore grams
    const newWeight = parseFloat((oldWeight * 1000).toFixed(3));
    console.log(`Fixing [${item.branch_id}] ${item.bill_no}: ${oldWeight}g -> ${newWeight}g (Price: Rs. ${item.price})`);

    const { error: updateErr } = await supabase
      .from('stock_items')
      .update({ weight: newWeight })
      .eq('id', item.id);

    if (updateErr) {
      console.error(`Failed to update ${item.id}:`, updateErr.message);
    } else {
      fixedCount++;
    }
  }

  console.log(`\nSuccessfully fixed ${fixedCount} of ${items.length} tiny weight items in stock_items.`);

  // Also check pawns table for tiny weights
  const { data: pawns, error: pawnErr } = await supabase
    .from('pawns')
    .select('id, bill_no, branch_id, weight, weight_mg, disbursed_amount')
    .gt('weight', 0)
    .lt('weight', 0.08);

  if (pawnErr) {
    console.error("Error fetching pawns:", pawnErr);
    return;
  }

  console.log(`\nFound ${pawns.length} pawns with weight < 0.08g:`);
  let fixedPawnsCount = 0;

  for (const p of pawns) {
    const oldWeight = parseFloat(p.weight);
    const newWeight = parseFloat((oldWeight * 1000).toFixed(3));
    const newWeightMg = Math.round(newWeight * 1000);
    console.log(`Fixing Pawn [${p.branch_id}] ${p.bill_no}: weight ${oldWeight}g -> ${newWeight}g, weight_mg -> ${newWeightMg}mg`);

    const { error: pUpErr } = await supabase
      .from('pawns')
      .update({ weight: newWeight, weight_mg: newWeightMg })
      .eq('id', p.id);

    if (pUpErr) {
      console.error(`Failed to update pawn ${p.id}:`, pUpErr.message);
    } else {
      fixedPawnsCount++;
    }
  }

  console.log(`Successfully fixed ${fixedPawnsCount} of ${pawns.length} tiny weight items in pawns.`);
}

fixTinyWeights().catch(console.error);
