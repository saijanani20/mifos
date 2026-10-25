const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env or .env.local if present
try {
  const dotenvPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(dotenvPath)) {
    const envContent = fs.readFileSync(dotenvPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

const ALL_TABLES = [
  'branches',
  'profiles',
  'branch_status',
  'clients',
  'pawns',
  'pawn_items',
  'transaction',
  'audit_logs',
  'stock_items',
  'stock_customers',
  'stock_interests',
  'daily_ledgers',
  'daily_ledger_transactions',
  'daily_ledger_expenses',
  'vault_transfer',
  'journal_entry',
  'journal_entry_line',
  'account',
  'cctv_cameras',
  'cctv_recordings',
  'cctv_audit_logs',
  'sms_logs'
];

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', '..', 'backups', `backup_${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`\n=============================================`);
  console.log(`Starting Mifos Supabase Database Backup...`);
  console.log(`Destination: ${backupDir}`);
  console.log(`=============================================\n`);

  const summary = {
    timestamp: new Date().toISOString(),
    sourceUrl: SUPABASE_URL,
    tables: {}
  };

  for (const table of ALL_TABLES) {
    try {
      let allRows = [];
      const pageSize = 1000;
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .range(from, from + pageSize - 1);

        if (error) {
          console.log(`[-] ${table}: Skipped / Not found (${error.message})`);
          hasMore = false;
          break;
        }

        if (data && data.length > 0) {
          allRows = allRows.concat(data);
          from += pageSize;
          if (data.length < pageSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      if (allRows.length > 0 || !summary.tables[table]) {
        summary.tables[table] = allRows.length;
        const filePath = path.join(backupDir, `${table}.json`);
        fs.writeFileSync(filePath, JSON.stringify(allRows, null, 2), 'utf8');
        console.log(`[✔] ${table.padEnd(26)} -> ${allRows.length} rows saved`);
      }
    } catch (err) {
      console.error(`[!] Error exporting ${table}:`, err.message);
    }
  }

  const summaryPath = path.join(backupDir, `_backup_summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n=============================================`);
  console.log(` Backup completed successfully!`);
  console.log(` Saved to: ${backupDir}`);
  console.log(`=============================================\n`);
}

runBackup().catch(err => {
  console.error("Backup failed:", err);
  process.exit(1);
});
