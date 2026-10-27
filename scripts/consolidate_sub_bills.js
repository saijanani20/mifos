const path = require('path');
const { createClient } = require(path.resolve(__dirname, '../frontend/node_modules/@supabase/supabase-js'));
require(path.resolve(__dirname, '../frontend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../frontend/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log('--- STARTING SUB-BILL CONSOLIDATION (OPTION 1) ---');

  // Fetch all stock_items
  let page = 0, pageSize = 1000, allStock = [];
  while (true) {
    const { data, error } = await supabase
      .from('stock_items')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      console.error('Fetch error:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allStock = allStock.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  console.log(`Fetched total ${allStock.length} stock items.`);

  const dashed = allStock.filter(i => /-\d+$/.test(i.bill_no || ''));
  console.log(`Found ${dashed.length} sub-bill items to consolidate.`);

  // Group by (branch_id, baseBill)
  const grouped = {};
  for (const item of dashed) {
    const base = item.bill_no.replace(/-\d+$/, '').trim();
    const key = `${item.branch_id}::${base}`;
    if (!grouped[key]) {
      grouped[key] = {
        branch_id: item.branch_id,
        baseBill: base,
        items: [],
        existingBase: allStock.find(x => x.branch_id === item.branch_id && x.bill_no === base && !/-\d+$/.test(x.bill_no))
      };
    }
    grouped[key].items.push(item);
  }

  const groupKeys = Object.keys(grouped);
  console.log(`Unique sub-bill groups to process: ${groupKeys.length}`);

  let updatedCount = 0;
  let deletedCount = 0;

  for (const key of groupKeys) {
    const g = grouped[key];
    console.log(`\nProcessing: ${g.branch_id} - ${g.baseBill} (sub-items: ${g.items.length}, existingBase: ${Boolean(g.existingBase)})`);

    if (g.existingBase) {
      // Base bill already exists. Sub-items are redundant duplicates.
      const idsToDelete = g.items.map(x => x.id);
      const { error: delErr } = await supabase.from('stock_items').delete().in('id', idsToDelete);
      if (delErr) {
        console.error(`Error deleting redundant sub-items for ${g.baseBill}:`, delErr);
      } else {
        console.log(`  -> Deleted ${idsToDelete.length} redundant sub-items (Base bill ${g.baseBill} already active).`);
        deletedCount += idsToDelete.length;
      }
    } else {
      // Base bill does not exist yet. Consolidate sub-items into single base bill record!
      const totalWeight = g.items.reduce((s, it) => s + (parseFloat(it.weight) || 0), 0);
      const totalPrice = g.items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0);
      const allTypes = Array.from(new Set(g.items.flatMap(it => (it.item_type || '').split(',').map(t => t.trim())))).filter(Boolean);
      const combinedType = allTypes.join(', ') || 'Gold';

      const primaryItem = g.items[0];
      const otherItemIds = g.items.slice(1).map(x => x.id);

      // Update primary item to base bill
      const { error: upErr } = await supabase.from('stock_items').update({
        bill_no: g.baseBill,
        weight: parseFloat(totalWeight.toFixed(4)),
        price: parseFloat(totalPrice.toFixed(2)),
        item_type: combinedType
      }).eq('id', primaryItem.id);

      if (upErr) {
        console.error(`Error updating primary item ${primaryItem.id} to ${g.baseBill}:`, upErr);
      } else {
        console.log(`  -> Consolidated ${g.items.length} items into ${g.baseBill} (Weight: ${totalWeight.toFixed(4)}g, Price: Rs. ${totalPrice.toLocaleString()}, Type: ${combinedType})`);
        updatedCount++;
      }

      // Delete other items in group if any
      if (otherItemIds.length > 0) {
        const { error: delOtherErr } = await supabase.from('stock_items').delete().in('id', otherItemIds);
        if (delOtherErr) {
          console.error(`Error deleting other sub-items for ${g.baseBill}:`, delOtherErr);
        } else {
          deletedCount += otherItemIds.length;
        }
      }
    }
  }

  console.log(`\n--- CONSOLIDATION COMPLETE ---`);
  console.log(`Updated to single bills: ${updatedCount}`);
  console.log(`Deleted redundant sub-item records: ${deletedCount}`);

  // Clean pawn_items descriptions as well
  const { data: pItems } = await supabase.from('pawn_items').select('id, description');
  let pCleanCount = 0;
  if (pItems) {
    for (const pi of pItems) {
      if (pi.description && /-\d+\)/.test(pi.description)) {
        const cleaned = pi.description.replace(/-\d+\)/g, ')');
        await supabase.from('pawn_items').update({ description: cleaned }).eq('id', pi.id);
        pCleanCount++;
      }
    }
  }
  console.log(`Cleaned ${pCleanCount} pawn_items descriptions.`);
}

run().catch(console.error);
