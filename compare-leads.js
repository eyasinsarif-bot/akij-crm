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

function normalize(name) {
  return name.toLowerCase()
    .replace(/\([^)]*\)/g, '') // remove parenthetical
    .replace(/ltd\.?/g, 'limited')
    .replace(/pvt\.?/g, 'private')
    .replace(/pte\.?/g, '')
    .replace(/co\.?/g, 'company')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '') // remove all non-alphanumeric
    .replace(/\s+/g, '')
    .trim();
}

const leadsCsv = fs.readFileSync('leads-data.csv', 'utf8');
const leadsRows = parseCSV(leadsCsv);
const seed = JSON.parse(fs.readFileSync('seed-real.json', 'utf8'));

// Build normalized existing customer set
const existingNorm = new Set();
seed.customers.forEach(c => {
  existingNorm.add(normalize(c.name));
  // also add without "limited" suffix
  const simple = normalize(c.name).replace('limited', '').replace('private', '');
  existingNorm.add(simple);
});

// Match leads against existing
const newLeads = [];
const matched = [];
for (let i = 1; i < leadsRows.length; i++) {
  const r = leadsRows[i];
  if (!r || !r[1]) continue;
  const company = r[1].trim();
  const norm = normalize(company);
  const simple = norm.replace('limited', '').replace('private', '');

  // Check if matches existing
  let isExisting = false;
  if (existingNorm.has(norm) || existingNorm.has(simple)) {
    isExisting = true;
  } else {
    // Check substring match
    for (const ex of existingNorm) {
      if (ex.length > 3 && (norm.includes(ex) || ex.includes(norm))) {
        isExisting = true;
        break;
      }
    }
  }

  if (isExisting) {
    matched.push(company);
  } else {
    newLeads.push({
      name: company,
      brand: r[2] || '',
      contact_person: r[3] || '',
      designation: r[4] || '',
      phone: r[5] || '',
      email: r[6] || '',
      office_address: r[7] || '',
      factory_address: r[8] || ''
    });
  }
}

console.log('Total leads sheet entries:', leadsRows.length - 1);
console.log('Already existing customers (skipped):', matched.length);
matched.forEach(m => console.log('  SKIP: ' + m));
console.log('\nNew leads to add:', newLeads.length);
newLeads.forEach(l => console.log('  ADD: ' + l.name));

// Save new leads
const result = newLeads.map((l, i) => ({
  id: 'LEAD-' + String(i + 1).padStart(4, '0'),
  name: l.name,
  phone: l.phone,
  email: l.email,
  source: 'Feed Industry Prospect',
  status: 'new',
  salesperson: '',
  notes: (l.contact_person ? l.contact_person : '') + (l.designation ? ' (' + l.designation + ')' : '') + ' | Brand: ' + l.brand + ' | ' + (l.office_address || ''),
  value: 0,
  created_at: new Date().toISOString()
}));

fs.writeFileSync('new-leads.json', JSON.stringify(result, null, 2));
console.log('\nSaved new-leads.json with ' + result.length + ' leads');
