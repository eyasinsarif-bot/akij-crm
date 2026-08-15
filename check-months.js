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

async function main() {
  const csv = await fetch('https://docs.google.com/spreadsheets/d/1k3YNf8tCu3DyFpBZOFWjvByEpFYQVkf5/export?format=csv', 0);
  const rows = parseCSV(csv);
  const months = {}, years = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r && r.length >= 15) {
      const m = r[13] || 'Unknown';
      const y = r[14] || 'Unknown';
      months[m] = (months[m] || 0) + 1;
      years[y] = (years[y] || 0) + 1;
    }
  }
  console.log('Months:', JSON.stringify(months, null, 2));
  console.log('Years:', JSON.stringify(years, null, 2));
}
main();
