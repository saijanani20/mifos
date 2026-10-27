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

const ids = [
  '5b1b34b1-ac12-4cfd-bf51-13f608148db3',
  '283ad0c0-b8f9-49d0-82e2-791a135e78fe',
  '8c83f22e-377b-4385-a1f2-f8a2c79131c2'
];

async function run() {
  await supabase.from('stock_items').update({ bill_no: '1R 46354-1' }).eq('id', '5b1b34b1-ac12-4cfd-bf51-13f608148db3');
  await supabase.from('stock_items').update({ bill_no: '12R 37594-1' }).eq('id', '283ad0c0-b8f9-49d0-82e2-791a135e78fe');
  await supabase.from('stock_items').update({ bill_no: '3R 15888-1' }).eq('id', '8c83f22e-377b-4385-a1f2-f8a2c79131c2');
  console.log('Updated 3 remaining items successfully!');
}

run().catch(console.error);
