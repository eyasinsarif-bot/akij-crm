const fs = require('fs');

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

const csv = fs.readFileSync('sales-data.csv', 'utf8');
const rows = parseCSV(csv);
const header = rows[0];
console.log('Columns (index):');
header.forEach((h, i) => console.log(`  ${i}: ${h}`));

const salesmen = {};
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < 23) continue;
  const salesValue = parseFloat(r[17]) || 0;
  const costValue = parseFloat(r[19]) || 0;
  const profit = parseFloat(r[20]) || 0;
  const rawSalesman = r[21] || '';
  const district = r[22] || '';
  const qty = parseFloat(r[8]) || 0;

  let name = rawSalesman.replace(/^\d+\s*/, '').trim();
  if (!name) continue;

  if (!salesmen[name]) salesmen[name] = { name, count: 0, salesValue: 0, costValue: 0, profit: 0, qty: 0, districts: new Set() };
  salesmen[name].count++;
  salesmen[name].salesValue += salesValue;
  salesmen[name].costValue += costValue;
  salesmen[name].profit += profit;
  salesmen[name].qty += qty;
  if (district) salesmen[name].districts.add(district);
}

console.log('\nSALESMEN PERFORMANCE (by sales value):');
Object.values(salesmen)
  .sort((a,b) => b.salesValue - a.salesValue)
  .forEach(s => {
    console.log(`\n${s.name}`);
    console.log(`  Orders: ${s.count}`);
    console.log(`  Qty: ${s.qty.toFixed(2)} ton`);
    console.log(`  Sales: Tk ${s.salesValue.toLocaleString()} (${(s.salesValue/10000000).toFixed(2)} Cr)`);
    console.log(`  Cost: Tk ${s.costValue.toLocaleString()} (${(s.costValue/10000000).toFixed(2)} Cr)`);
    console.log(`  Profit: Tk ${s.profit.toLocaleString()} (${(s.profit/10000000).toFixed(2)} Cr)`);
    console.log(`  Districts: ${[...s.districts].join(', ')}`);
  });

// Save summary
const summary = Object.values(salesmen).map(s => ({
  name: s.name, count: s.count, qty: s.qty, salesValue: s.salesValue,
  costValue: s.costValue, profit: s.profit, districts: [...s.districts]
}));
fs.writeFileSync('sales-summary.json', JSON.stringify(summary, null, 2));
console.log('\nSaved sales-summary.json');
