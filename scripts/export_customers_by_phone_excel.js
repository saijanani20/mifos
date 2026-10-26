const { Client } = require(require.resolve('pg', { paths: ['d:/Mifos/frontend'] }));
const XLSX = require(require.resolve('xlsx', { paths: ['d:/Mifos/frontend'] }));
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.ielkaetihagxgnrrasch:pLlwUBNfHWUmxGJD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

function isValidPhone(p) {
  if (!p) return false;
  const digits = String(p).replace(/\D/g, '');
  if (!digits || digits.length < 9) return false;
  if (/^0+$/.test(digits)) return false;
  if (digits === '07' || digits === '077' || digits === '071') return false;
  return true;
}

function formatPhoneDisplay(p) {
  if (!isValidPhone(p)) return '-';
  const digits = String(p).replace(/\D/g, '');
  if (digits.length === 9) return '0' + digits;
  if (digits.length === 11 && digits.startsWith('94')) return '0' + digits.substring(2);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function normalizeKey(str) {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/[\s\-_/]+/g, '');
}

async function exportCustomersByPhone() {
  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('Fetching clients (lightweight metadata)...');
  const clientsRes = await client.query('SELECT id, national_id, first_name, last_name, phone, address, branch_id, status, created_at FROM public.clients ORDER BY branch_id, first_name');
  console.log('Fetching stock customers...');
  const scRes = await client.query('SELECT * FROM public.stock_customers ORDER BY name');
  console.log('Fetching pawns...');
  const pawnsRes = await client.query('SELECT client_id, bill_no, branch_id FROM public.pawns');
  console.log('Fetching stock items...');
  const stockRes = await client.query('SELECT bill_no, branch_id FROM public.stock_items');
  console.log('Fetching branches...');
  const branchRes = await client.query('SELECT id, name FROM public.branches');

  await client.end();

  const clients = clientsRes.rows;
  const stockCustomers = scRes.rows;
  const pawns = pawnsRes.rows;
  const stockItems = stockRes.rows;
  const branches = branchRes.rows;

  console.log(`Loaded: ${clients.length} clients, ${stockCustomers.length} stock customers, ${branches.length} branches.`);

  // Branch Map
  const branchMap = {};
  branches.forEach(b => {
    branchMap[b.id.toUpperCase()] = b.name;
  });

  // Client to Pawns map
  const clientPawnsMap = new Map();
  pawns.forEach(p => {
    if (p.client_id) {
      if (!clientPawnsMap.has(p.client_id)) clientPawnsMap.set(p.client_id, []);
      if (p.bill_no) clientPawnsMap.get(p.client_id).push(p.bill_no);
    }
  });

  // Stock customers lookup by NIC and Phone
  const scByNic = new Map();
  const scByPhone = new Map();
  const scByName = new Map();

  stockCustomers.forEach(sc => {
    if (sc.nic) {
      const norm = normalizeKey(sc.nic);
      if (norm && norm.length >= 7) scByNic.set(norm, sc);
    }
    if (isValidPhone(sc.tp)) {
      scByPhone.set(formatPhoneDisplay(sc.tp), sc);
    }
    if (sc.name) {
      scByName.set(sc.name.trim().toLowerCase(), sc);
    }
  });

  // Helper to find associated bill numbers for a client
  function getBillsForClient(c) {
    const pawnBills = clientPawnsMap.get(c.id) || [];
    if (pawnBills.length > 0) return pawnBills.join(', ');

    const normNic = normalizeKey(c.national_id);
    const matchedSc = scByNic.get(normNic) || (isValidPhone(c.phone) ? scByPhone.get(formatPhoneDisplay(c.phone)) : null) || scByName.get(`${c.first_name} ${c.last_name || ''}`.trim().toLowerCase());
    if (matchedSc && matchedSc.bill_numbers) {
      return matchedSc.bill_numbers;
    }
    return '-';
  }

  // --------------------------------------------------------------------------
  // SHEET 1: Registered Clients WITH Phone Number
  // --------------------------------------------------------------------------
  const clientsWithPhoneRows = [];
  // SHEET 2: Registered Clients WITHOUT Phone Number
  const clientsWithoutPhoneRows = [];

  clients.forEach(c => {
    const branchCode = (c.branch_id || 'HQ').toUpperCase();
    const branchName = branchMap[branchCode] || branchCode;
    const fullName = `${c.first_name || ''} ${c.last_name && c.last_name !== '.' ? c.last_name : ''}`.trim();
    const bills = getBillsForClient(c);
    const regDate = c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : '';

    if (isValidPhone(c.phone)) {
      clientsWithPhoneRows.push({
        'Client ID': c.id,
        'Customer Name': fullName,
        'Telephone (TP)': formatPhoneDisplay(c.phone),
        'NIC / National ID': c.national_id || '-',
        'Branch Code': branchCode,
        'Branch Name': branchName,
        'Address': c.address || '-',
        'Status': c.status || 'ACTIVE',
        'Associated Bill Numbers': bills,
        'Registered Date': regDate
      });
    } else {
      let rawVal = c.phone ? String(c.phone).trim() : 'NO_PHONE_ENTERED';
      if (/^0+$/.test(rawVal)) rawVal = 'DUMMY_ZERO (' + rawVal + ')';
      
      clientsWithoutPhoneRows.push({
        'Client ID': c.id,
        'Customer Name': fullName,
        'Original Phone Field': rawVal,
        'Phone Missing Reason': rawVal.includes('DUMMY') ? 'Dummy Zero Entered' : 'Blank / Null in records',
        'NIC / National ID': c.national_id || '-',
        'Branch Code': branchCode,
        'Branch Name': branchName,
        'Address': c.address || '-',
        'Status': c.status || 'ACTIVE',
        'Associated Bill Numbers': bills,
        'Action Required': 'Collect telephone number on next branch visit',
        'Registered Date': regDate
      });
    }
  });

  // --------------------------------------------------------------------------
  // SHEET 3: Stock Customers WITH Phone Number
  // --------------------------------------------------------------------------
  const stockWithPhoneRows = [];
  // SHEET 4: Stock Customers WITHOUT Phone Number
  const stockWithoutPhoneRows = [];

  // Stock item to branch map
  const stockBranchMap = new Map();
  stockItems.forEach(s => {
    if (s.bill_no && s.branch_id) {
      stockBranchMap.set(normalizeKey(s.bill_no), s.branch_id.toUpperCase());
    }
  });

  stockCustomers.forEach(sc => {
    let branch = null;
    if (sc.bill_numbers) {
      const parts = sc.bill_numbers.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        const b = stockBranchMap.get(normalizeKey(p));
        if (b) { branch = b; break; }
        const pref = p.match(/^[a-zA-Z0-9]+/)?.[0]?.toUpperCase();
        if (pref && branchMap[pref]) { branch = pref; break; }
      }
    }
    const branchCode = branch || 'HQ';
    const branchName = branchMap[branchCode] || branchCode;
    const regDate = sc.created_at ? new Date(sc.created_at).toISOString().split('T')[0] : '';

    if (isValidPhone(sc.tp)) {
      stockWithPhoneRows.push({
        'Stock Customer ID': sc.id,
        'Customer Name': sc.name || '',
        'Telephone (TP)': formatPhoneDisplay(sc.tp),
        'NIC Number': sc.nic || '-',
        'Branch Code': branchCode,
        'Branch Name': branchName,
        'Address': sc.address || '-',
        'Address Line 2': sc.address_2 || '',
        'Associated Bills': sc.bill_numbers || '-',
        'Created Date': regDate
      });
    } else {
      let rawVal = sc.tp ? String(sc.tp).trim() : 'EMPTY_PHONE';
      if (/^0+$/.test(rawVal)) rawVal = 'DUMMY_ZERO (' + rawVal + ')';

      stockWithoutPhoneRows.push({
        'Stock Customer ID': sc.id,
        'Customer Name': sc.name || '',
        'Original Phone Field': rawVal,
        'NIC Number': sc.nic || '-',
        'Branch Code': branchCode,
        'Branch Name': branchName,
        'Address': sc.address || '-',
        'Address Line 2': sc.address_2 || '',
        'Associated Bills': sc.bill_numbers || '-',
        'Action Required': 'Collect telephone number on next branch visit',
        'Created Date': regDate
      });
    }
  });

  // --------------------------------------------------------------------------
  // SHEET 5: Summary By Branch
  // --------------------------------------------------------------------------
  const branchSummary = {};
  branches.forEach(b => {
    branchSummary[b.id.toUpperCase()] = {
      code: b.id.toUpperCase(),
      name: b.name,
      clientsTotal: 0,
      clientsWithPhone: 0,
      clientsWithoutPhone: 0,
      stockTotal: 0,
      stockWithPhone: 0,
      stockWithoutPhone: 0
    };
  });

  clients.forEach(c => {
    const b = (c.branch_id || 'HQ').toUpperCase();
    if (!branchSummary[b]) {
      branchSummary[b] = { code: b, name: b, clientsTotal: 0, clientsWithPhone: 0, clientsWithoutPhone: 0, stockTotal: 0, stockWithPhone: 0, stockWithoutPhone: 0 };
    }
    branchSummary[b].clientsTotal++;
    if (isValidPhone(c.phone)) branchSummary[b].clientsWithPhone++;
    else branchSummary[b].clientsWithoutPhone++;
  });

  stockCustomers.forEach(sc => {
    let b = null;
    if (sc.bill_numbers) {
      const parts = sc.bill_numbers.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        const br = stockBranchMap.get(normalizeKey(p));
        if (br) { b = br; break; }
      }
    }
    const bCode = (b || 'HQ').toUpperCase();
    if (branchSummary[bCode]) {
      branchSummary[bCode].stockTotal++;
      if (isValidPhone(sc.tp)) branchSummary[bCode].stockWithPhone++;
      else branchSummary[bCode].stockWithoutPhone++;
    }
  });

  const summaryRows = Object.values(branchSummary)
    .filter(b => b.clientsTotal > 0 || b.stockTotal > 0)
    .map(b => ({
      'Branch Code': b.code,
      'Branch Name': b.name,
      'Registered Clients': b.clientsTotal,
      'Clients WITH Phone': b.clientsWithPhone,
      'Clients WITHOUT Phone': b.clientsWithoutPhone,
      'Client Phone Coverage %': b.clientsTotal > 0 ? ((b.clientsWithPhone / b.clientsTotal) * 100).toFixed(1) + '%' : '0.0%',
      'Stock Customers': b.stockTotal,
      'Stock WITH Phone': b.stockWithPhone,
      'Stock WITHOUT Phone': b.stockWithoutPhone
    }));

  // Append Total Row
  summaryRows.push({
    'Branch Code': 'TOTAL',
    'Branch Name': 'ALL BRANCHES COMBINED',
    'Registered Clients': clients.length,
    'Clients WITH Phone': clientsWithPhoneRows.length,
    'Clients WITHOUT Phone': clientsWithoutPhoneRows.length,
    'Client Phone Coverage %': ((clientsWithPhoneRows.length / clients.length) * 100).toFixed(1) + '%',
    'Stock Customers': stockCustomers.length,
    'Stock WITH Phone': stockWithPhoneRows.length,
    'Stock WITHOUT Phone': stockWithoutPhoneRows.length
  });

  // --------------------------------------------------------------------------
  // CREATE WORKBOOK & APPEND SHEETS
  // --------------------------------------------------------------------------
  const wb = XLSX.utils.book_new();

  function autoFitCols(ws, rows) {
    if (!rows || rows.length === 0) return;
    const keys = Object.keys(rows[0]);
    ws['!cols'] = keys.map(k => {
      let maxLen = k.length;
      for (let i = 0; i < Math.min(rows.length, 200); i++) {
        const val = rows[i][k];
        if (val !== null && val !== undefined) {
          maxLen = Math.max(maxLen, String(val).length);
        }
      }
      return { wch: Math.min(Math.max(maxLen + 3, 12), 48) };
    });
  }

  // 1. Clients With Phone
  const ws1 = XLSX.utils.json_to_sheet(clientsWithPhoneRows);
  autoFitCols(ws1, clientsWithPhoneRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Clients_WITH_Phone');

  // 2. Clients Without Phone
  const ws2 = XLSX.utils.json_to_sheet(clientsWithoutPhoneRows);
  autoFitCols(ws2, clientsWithoutPhoneRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Clients_WITHOUT_Phone');

  // 3. Stock With Phone
  const ws3 = XLSX.utils.json_to_sheet(stockWithPhoneRows);
  autoFitCols(ws3, stockWithPhoneRows);
  XLSX.utils.book_append_sheet(wb, ws3, 'Stock_Customers_WITH_Phone');

  // 4. Stock Without Phone
  const ws4 = XLSX.utils.json_to_sheet(stockWithoutPhoneRows);
  autoFitCols(ws4, stockWithoutPhoneRows);
  XLSX.utils.book_append_sheet(wb, ws4, 'Stock_Customers_NO_Phone');

  // 5. Summary
  const ws5 = XLSX.utils.json_to_sheet(summaryRows);
  autoFitCols(ws5, summaryRows);
  XLSX.utils.book_append_sheet(wb, ws5, 'Phone_Summary_By_Branch');

  // Write files
  const exportsDir = path.join('d:', 'Mifos', 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const outExcel = path.join(exportsDir, 'MIFOS_Customers_By_Telephone_Status.xlsx');
  const outCsvWith = path.join(exportsDir, 'MIFOS_Clients_WITH_Phone.csv');
  const outCsvWithout = path.join(exportsDir, 'MIFOS_Clients_WITHOUT_Phone.csv');

  XLSX.writeFile(wb, outExcel);
  fs.writeFileSync(outCsvWith, XLSX.utils.sheet_to_csv(ws1), 'utf8');
  fs.writeFileSync(outCsvWithout, XLSX.utils.sheet_to_csv(ws2), 'utf8');

  console.log('\nSUCCESS! Customers by Telephone Excel generated:');
  console.log(`1. Excel Workbook: ${outExcel}`);
  console.log(`2. CSV With Phone: ${outCsvWith}`);
  console.log(`3. CSV Without Phone: ${outCsvWithout}`);
  console.log(`\nStatistics:`);
  console.log(`- Clients WITH Phone: ${clientsWithPhoneRows.length}`);
  console.log(`- Clients WITHOUT Phone: ${clientsWithoutPhoneRows.length}`);
  console.log(`- Stock Customers WITH Phone: ${stockWithPhoneRows.length}`);
  console.log(`- Stock Customers WITHOUT Phone: ${stockWithoutPhoneRows.length}`);
}

exportCustomersByPhone().catch(err => {
  console.error('Fatal export error:', err);
  process.exit(1);
});
