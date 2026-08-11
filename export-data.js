const http = require('http');
const fs = require('fs');
const path = require('path');

async function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  try {
    const login = await api('POST', '/api/login', { username: 'admin', password: 'admin123' }, '');
    const token = login.token;
    console.log('Logged in');

    const customers = await api('GET', '/api/customers/dwh', null, token);
    const orders = await api('GET', '/api/orders/dwh', null, token);
    const leads = await api('GET', '/api/leads/dwh', null, token);
    const opportunities = await api('GET', '/api/opportunities/dwh', null, token);
    const complaints = await api('GET', '/api/complaints/dwh', null, token);
    const employees = await api('GET', '/api/employees/dwh', null, token);

    const seed = { customers, orders, leads, opportunities, complaints, employees };
    fs.writeFileSync(path.join(__dirname, 'data', 'seed-real.json'), JSON.stringify(seed));
    console.log('Saved:', customers.length, 'customers,', orders.length, 'orders,', leads.length, 'leads,', opportunities.length, 'opps,', complaints.length, 'complaints,', employees.length, 'employees');
  } catch(e) { console.log('Error:', e.message); }
})();
