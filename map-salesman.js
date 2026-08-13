const sql = require('mssql');
const fs = require('fs');
const https = require('https');

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function fetch(url, redirects) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        resolve(fetch(res.headers.location, redirects + 1));
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const GSHEETS_URL = 'https://docs.google.com/spreadsheets/d/1k3YNf8tCu3DyFpBZOFWjvByEpFYQVkf5/export?format=csv';

async function main() {
  // 1. Fetch Google Sheets and build SO->Salesman map
  console.log('Fetching Google Sheets...');
  const csv = await fetch(GSHEETS_URL, 0);
  const rows = parseCSV(csv);
  const soMap = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 23) continue;
    const soNum = (r[2] || '').trim();
    const rawSalesman = r[21] || '';
    const name = rawSalesman.replace(/^\d+\s*/, '').trim();
    if (soNum && name) soMap[soNum] = name;
  }
  console.log('SO->Salesman map:', Object.keys(soMap).length, 'entries');

  // 2. Fetch DWH orders with SO numbers
  await sql.connect({
    server: '203.202.241.211', port: 1433, database: 'DWH',
    user: 'mcp_user', password: 'iAOS@35o997',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 60000
  });
  console.log('Connected to DWH');
  const ordRaw = await sql.query("SELECT TOP 500 h.strSalesOrderCode as order_code, h.dteSalesOrderDate as order_date, h.strSoldToPartnerName as customer, h.numTotalOrderValue as total, h.isCompleted, h.isApproved, h.strPaymentTermsName, h.strSalesOfficeName, h.dteDueShippingDate, r.strItemName as product, r.numOrderQuantity as quantity, r.numItemPrice as unit_price, r.strUOM as uom FROM oms.tblSalesOrderHeaderArc h LEFT JOIN oms.tblSalesOrderRowArc r ON h.intSalesOrderId = r.intSalesOrderId AND r.intSequenceNo = 1 WHERE h.intBusinessUnitId=211 ORDER BY h.dteSalesOrderDate DESC");

  // 3. Build orders with mapped salesperson
  let matched = 0;
  const orders = ordRaw.recordset.map((r, i) => {
    const soNum = (r.order_code || '').trim();
    const salesperson = soMap[soNum] || r.strSalesOfficeName || 'Trading Sales';
    if (soMap[soNum]) matched++;
    return {
      id: 'SO-' + String(i + 1).padStart(5, '0'),
      order_code: soNum,
      customer: r.customer || 'Unknown',
      salesperson: salesperson,
      product: r.product || '',
      quantity: r.quantity || 0,
      unit_price: r.unit_price || 0,
      total: r.total || 0,
      status: r.isCompleted ? 'delivered' : (r.isApproved ? 'processing' : 'pending'),
      order_date: r.order_date ? new Date(r.order_date).toISOString().slice(0,10) : '',
      delivery_date: r.due_date ? new Date(r.due_date).toISOString().slice(0,10) : '',
      created_at: new Date().toISOString()
    };
  });
  console.log(`Orders: ${orders.length}, matched salesman: ${matched}`);

  // 4. Save to seed
  const seed = JSON.parse(fs.readFileSync('seed-real.json', 'utf8'));
  seed.orders = orders;
  fs.writeFileSync('seed-real.json', JSON.stringify(seed, null, 2));
  fs.copyFileSync('seed-real.json', 'data/seed-real.json');
  console.log('Saved seed-real.json with mapped salesperson');

  await sql.close();
}
main().catch(e => console.log('ERROR:', e.message));
