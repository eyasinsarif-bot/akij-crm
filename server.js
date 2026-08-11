const express = require('express');
const crypto = require('crypto');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const KEY_LEN = 64;
const SESSION_EXPIRY = 24 * 60 * 60 * 1000;
const BU_ID = 211;

// DWH pool for CRM data
let dwhPool = null;
async function getDWHPool() {
  if (dwhPool && dwhPool.connected) return dwhPool;
  dwhPool = await new sql.ConnectionPool({
    server: '203.202.241.211', port: 1433, database: 'DWH',
    user: 'mcp_user', password: 'iAOS@35o997',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 30000,
    pool: { max: 5, min: 1, idleTimeoutMillis: 30000 }
  }).connect();
  console.log('DWH connected');
  return dwhPool;
}

async function runDWHQuery(query) {
  const p = await getDWHPool();
  const r = await p.request().query(query);
  return r.recordset;
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// SQL Server pool
let pool = null;
async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect({
    server: '203.202.241.211', port: 1433, database: 'DataMart',
    user: 'mcp_user', password: 'iAOS@35o997',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 30000,
    pool: { max: 5, min: 1, idleTimeoutMillis: 30000 }
  });
  console.log('SQL Server connected - DataMart');
  return pool;
}

async function runQuery(query) {
  const p = await getPool();
  const r = await p.request().query(query);
  return r.recordset;
}

// JSON file store
function readJSON(fn) {
  const fp = path.join(DATA_DIR, fn + '.json');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return []; }
}
function writeJSON(fn, data) { fs.writeFileSync(path.join(DATA_DIR, fn + '.json'), JSON.stringify(data, null, 2)); }

function nextId(prefix) {
  const cf = path.join(DATA_DIR, '_counters.json');
  let c = {}; if (fs.existsSync(cf)) { try { c = JSON.parse(fs.readFileSync(cf, 'utf-8')); } catch {} }
  if (!c[prefix]) c[prefix] = 0;
  c[prefix]++;
  fs.writeFileSync(cf, JSON.stringify(c));
  return prefix + '-' + String(c[prefix]).padStart(5, '0');
}

function hashPassword(pw) { const s = crypto.randomBytes(16).toString('hex'); const h = crypto.scryptSync(pw, s, KEY_LEN).toString('hex'); return s + ':' + h; }
function verifyPassword(pw, st) { const [s, h] = st.split(':'); return crypto.scryptSync(pw, s, KEY_LEN).toString('hex') === h; }

const sessions = new Map();
function createSession(un, role) { const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, { username: un, role, createdAt: Date.now() }); return t; }
function validateSession(t) { const s = sessions.get(t); if (!s) return null; if (Date.now() - s.createdAt > SESSION_EXPIRY) { sessions.delete(t); return null; } return s; }

const rateLimits = new Map();
function checkRateLimit(ip, limit, windowMs) {
  const now = Date.now(); const k = ip;
  if (!rateLimits.has(k)) rateLimits.set(k, []);
  const e = rateLimits.get(k).filter(t => now - t < windowMs); e.push(now); rateLimits.set(k, e);
  return e.length <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rateLimits) { const f = e.filter(t => now - t < 60000); if (f.length === 0) rateLimits.delete(k); else rateLimits.set(k, f); }
  for (const [t, s] of sessions) { if (now - s.createdAt > SESSION_EXPIRY) sessions.delete(t); }
}, 60000);

function authRequired(req, res, next) {
  const a = req.headers.authorization;
  if (!a || !a.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const s = validateSession(a.slice(7)); if (!s) return res.status(401).json({ error: 'Session expired' });
  req.session = s; next();
}
function roleRequired(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com");
  next();
});

function sanitizeAccounts(accs) { return accs.map(({ password, ...r }) => r); }
function sanitizeUser(u) { const { password, ...r } = u; return r; }

const DATA_FILES = ['customers', 'leads', 'opportunities', 'orders', 'complaints', 'visits', 'accounts'];

function wipeDataFiles() { DATA_FILES.forEach(f => writeJSON(f, [])); }

function crudRoutes(entityName, routePath) {
  const router = express.Router();
  router.get('/', authRequired, (req, res) => {
    let data = readJSON(entityName);
    if (entityName === 'accounts') data = sanitizeAccounts(data);
    res.json(data);
  });
  router.post('/', authRequired, (req, res) => {
    const data = readJSON(entityName);
    const prefix = entityName === 'customers' ? 'CUS' : entityName === 'leads' ? 'LEAD' : entityName === 'opportunities' ? 'OPP' :
      entityName === 'orders' ? 'ORD' : entityName === 'complaints' ? 'CMP' : entityName === 'visits' ? 'VIS' : 'ACC';
    const item = { id: nextId(prefix), ...req.body, created_at: new Date().toISOString() };
    data.push(item); writeJSON(entityName, data);
    console.log(`[AUDIT] CREATE ${entityName}: ${item.id} by ${req.session.username}`);
    res.status(201).json(item);
  });
  router.put('/:id', authRequired, (req, res) => {
    const data = readJSON(entityName);
    const idx = data.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data[idx] = { ...data[idx], ...req.body, updated_at: new Date().toISOString() };
    writeJSON(entityName, data);
    console.log(`[AUDIT] UPDATE ${entityName}: ${req.params.id} by ${req.session.username}`);
    res.json(data[idx]);
  });
  router.delete('/:id', authRequired, (req, res) => {
    let data = readJSON(entityName);
    const idx = data.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.splice(idx, 1); writeJSON(entityName, data);
    console.log(`[AUDIT] DELETE ${entityName}: ${req.params.id} by ${req.session.username}`);
    res.json({ success: true });
  });
  app.use('/api/' + routePath, router);
}

function seedAccounts() {
  const accs = [
    { id: 'ACC-00001', username: 'admin', password: hashPassword('admin123'), name: 'System Admin', role: 'super_admin', territory: 'HQ', created_at: new Date().toISOString() },
    { id: 'ACC-00002', username: 'rahim', password: hashPassword('rahim123'), name: 'Rahim Uddin', role: 'admin', territory: 'Dhaka', supervisor: 'admin', created_at: new Date().toISOString() },
    { id: 'ACC-00003', username: 'karim', password: hashPassword('karim123'), name: 'Karim Mia', role: 'sales_head', territory: 'Dhaka', supervisor: 'rahim', created_at: new Date().toISOString() },
    { id: 'ACC-00004', username: 'sohag', password: hashPassword('sohag123'), name: 'Sohag Hossain', role: 'so', territory: 'Dhaka North', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00005', username: 'sakib', password: hashPassword('sakib123'), name: 'Sakib Hasan', role: 'so', territory: 'Dhaka South', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00006', username: 'rafiq', password: hashPassword('rafiq123'), name: 'Rafiq Islam', role: 'so', territory: 'Gazipur', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00007', username: 'nisha', password: hashPassword('nisha123'), name: 'Nisha Akter', role: 'so', territory: 'Narayanganj', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00008', username: 'ccenter', password: hashPassword('ccenter123'), name: 'Contact Center', role: 'contact_center', territory: 'HQ', created_at: new Date().toISOString() },
    { id: 'ACC-00009', username: 'excellence', password: hashPassword('excel123'), name: 'Sales Excellence', role: 'sales_excellence', territory: 'HQ', created_at: new Date().toISOString() },
    { id: 'ACC-00010', username: 'mgmt', password: hashPassword('mgmt123'), name: 'Management User', role: 'management', territory: 'HQ', created_at: new Date().toISOString() },
  ];
  writeJSON('accounts', accs);
}

function seedDemoData() {
  writeJSON('customers', [
    { id: 'CUS-00001', name: 'BuildMart Ltd.', phone: '01710000001', email: 'info@buildmart.com', address: '123 Gulshan Ave, Dhaka', salesperson: 'Sohag Hossain', status: 'active', source: 'Referral', created_at: new Date(Date.now() - 30*86400000).toISOString() },
    { id: 'CUS-00002', name: 'SteelCraft Industries', phone: '01710000002', email: 'contact@steelcraft.com', address: '45 Tejgaon I/A, Dhaka', salesperson: 'Sohag Hossain', status: 'active', source: 'Walk-in', created_at: new Date(Date.now() - 25*86400000).toISOString() },
    { id: 'CUS-00003', name: 'GreenBuild Developers', phone: '01710000003', email: 'sales@greenbuild.com', address: '78 Banani, Dhaka', salesperson: 'Sakib Hasan', status: 'active', source: 'Website', created_at: new Date(Date.now() - 20*86400000).toISOString() },
    { id: 'CUS-00004', name: 'Metro Construction', phone: '01710000004', email: 'info@metrocon.com', address: '12 Mirpur Rd, Dhaka', salesperson: 'Sakib Hasan', status: 'active', source: 'Trade Show', created_at: new Date(Date.now() - 15*86400000).toISOString() },
    { id: 'CUS-00005', name: 'Prime Builders', phone: '01710000005', email: 'hello@primebuilders.com', address: '56 Uttara, Dhaka', salesperson: 'Sakib Hasan', status: 'inactive', source: 'Cold Call', created_at: new Date(Date.now() - 10*86400000).toISOString() },
    { id: 'CUS-00006', name: 'Akij Ceramics Dealer', phone: '01710000006', email: 'dealer@akij.com', address: '34 Motijheel, Dhaka', salesperson: 'Rafiq Islam', status: 'active', source: 'Existing', created_at: new Date(Date.now() - 8*86400000).toISOString() },
    { id: 'CUS-00007', name: 'National Housing', phone: '01710000007', email: 'info@nationalhousing.com', address: '90 Dhanmondi, Dhaka', salesperson: 'Rafiq Islam', status: 'active', source: 'Referral', created_at: new Date(Date.now() - 5*86400000).toISOString() },
    { id: 'CUS-00008', name: 'City Developers Ltd.', phone: '01710000008', email: 'admin@citydev.com', address: '23 Bashundhara, Dhaka', salesperson: 'Nisha Akter', status: 'lead', source: 'Website', created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'CUS-00009', name: 'Sunrise Properties', phone: '01710000009', email: 'care@sunriseprop.com', address: '67 Baridhara, Dhaka', salesperson: 'Nisha Akter', status: 'active', source: 'Social Media', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'CUS-00010', name: 'Mega Infra Ltd.', phone: '01710000010', email: 'info@megainfra.com', address: '88 Gulshan-2, Dhaka', salesperson: 'Sohag Hossain', status: 'lead', source: 'Email Campaign', created_at: new Date().toISOString() },
  ]);
  writeJSON('leads', [
    { id: 'LEAD-00001', name: 'Alam Group', phone: '01720000001', email: 'alam@group.com', source: 'Website', status: 'new', salesperson: 'Sohag Hossain', notes: 'Interested in bulk cement', value: 500000, created_at: new Date(Date.now() - 5*86400000).toISOString() },
    { id: 'LEAD-00002', name: 'Bismillah Traders', phone: '01720000002', email: 'bismillah@traders.com', source: 'Referral', status: 'contacted', salesperson: 'Sakib Hasan', notes: 'Needs steel rods quote', value: 300000, created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'LEAD-00003', name: 'Chowdhury Enterprise', phone: '01720000003', email: 'chowdhury@ent.com', source: 'Walk-in', status: 'qualified', salesperson: 'Rafiq Islam', notes: 'Ready to sign', value: 800000, created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'LEAD-00004', name: 'Dhaka Mega Mart', phone: '01720000004', email: 'dmart@dm.com', source: 'Trade Show', status: 'new', salesperson: 'Nisha Akter', notes: 'Cement and tiles', value: 1200000, created_at: new Date(Date.now() - 1*86400000).toISOString() },
    { id: 'LEAD-00005', name: 'Eastern Suppliers', phone: '01720000005', email: 'eastern@supply.com', source: 'Cold Call', status: 'lost', salesperson: 'Sohag Hossain', notes: 'Went with competitor', value: 200000, created_at: new Date().toISOString() },
  ]);
  writeJSON('opportunities', [
    { id: 'OPP-00001', name: 'BuildMart Cement Supply', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', stage: 'Negotiation', value: 800000, probability: 70, expected_close: '2026-09-15', created_at: new Date(Date.now() - 10*86400000).toISOString() },
    { id: 'OPP-00002', name: 'SteelCraft Rods Deal', customer: 'SteelCraft Industries', salesperson: 'Sohag Hossain', stage: 'Proposal', value: 1200000, probability: 50, expected_close: '2026-10-01', created_at: new Date(Date.now() - 8*86400000).toISOString() },
    { id: 'OPP-00003', name: 'GreenBuild Tiles Order', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', stage: 'Qualification', value: 500000, probability: 30, expected_close: '2026-09-30', created_at: new Date(Date.now() - 5*86400000).toISOString() },
    { id: 'OPP-00004', name: 'Metro Sanitary Ware', customer: 'Metro Construction', salesperson: 'Sakib Hasan', stage: 'Closed Won', value: 350000, probability: 100, expected_close: '2026-08-15', created_at: new Date(Date.now() - 12*86400000).toISOString() },
  ]);
  writeJSON('orders', [
    { id: 'ORD-00001', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', product: 'Cement OPC 50kg', quantity: 500, unit_price: 420, total: 210000, status: 'delivered', order_date: '2026-08-01', delivery_date: '2026-08-05', created_at: new Date(Date.now() - 10*86400000).toISOString() },
    { id: 'ORD-00002', customer: 'SteelCraft Industries', salesperson: 'Sohag Hossain', product: 'Steel Rods 60 Grade', quantity: 200, unit_price: 850, total: 170000, status: 'pending', order_date: '2026-08-03', created_at: new Date(Date.now() - 8*86400000).toISOString() },
    { id: 'ORD-00003', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', product: 'Ceramic Tiles', quantity: 1000, unit_price: 55, total: 55000, status: 'processing', order_date: '2026-08-05', created_at: new Date(Date.now() - 6*86400000).toISOString() },
    { id: 'ORD-00004', customer: 'Metro Construction', salesperson: 'Sakib Hasan', product: 'Sanitary Ware Set', quantity: 50, unit_price: 1200, total: 60000, status: 'delivered', order_date: '2026-08-07', delivery_date: '2026-08-09', created_at: new Date(Date.now() - 4*86400000).toISOString() },
    { id: 'ORD-00005', customer: 'Akij Ceramics Dealer', salesperson: 'Rafiq Islam', product: 'Tiles Premium', quantity: 2000, unit_price: 65, total: 130000, status: 'pending', order_date: '2026-08-10', created_at: new Date(Date.now() - 1*86400000).toISOString() },
  ]);
  writeJSON('complaints', [
    { id: 'CMP-00001', customer: 'Prime Builders', subject: 'Delayed delivery', description: 'Order not delivered on promised date', priority: 'high', status: 'open', assigned_to: 'Contact Center', created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'CMP-00002', customer: 'City Developers Ltd.', subject: 'Product quality issue', description: 'Tiles have color variation', priority: 'medium', status: 'in_progress', assigned_to: 'Contact Center', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'CMP-00003', customer: 'Metro Construction', subject: 'Billing discrepancy', description: 'Invoice amount does not match PO', priority: 'low', status: 'resolved', assigned_to: 'Contact Center', created_at: new Date(Date.now() - 5*86400000).toISOString() },
  ]);
  writeJSON('visits', [
    { id: 'VIS-00001', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', purpose: 'Follow-up', visit_type: 'sales', outcome: 'Positive', visit_date: '2026-08-10', next_visit: '2026-08-17', notes: 'Customer happy with product quality', created_at: new Date(Date.now() - 1*86400000).toISOString() },
    { id: 'VIS-00002', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', purpose: 'New product intro', visit_type: 'sales', outcome: 'Interested', visit_date: '2026-08-09', next_visit: '2026-08-20', notes: 'Requested quotation for tiles', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'VIS-00003', customer: 'Akij Ceramics Dealer', salesperson: 'Rafiq Islam', purpose: 'Order collection', visit_type: 'sales', outcome: 'Completed', visit_date: '2026-08-08', notes: '', created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'VIS-00004', customer: 'National Housing', salesperson: 'Rafiq Islam', purpose: 'Site inspection', visit_type: 'quality_control', outcome: 'Positive', visit_date: '2026-08-11', next_visit: '2026-08-25', notes: 'Quality check passed, minor rework needed', created_at: new Date().toISOString() },
    { id: 'VIS-00005', customer: 'Sunrise Properties', salesperson: 'Nisha Akter', purpose: 'Product demo', visit_type: 'sales', outcome: 'Interested', visit_date: '2026-08-11', notes: '', created_at: new Date().toISOString() },
    { id: 'VIS-00006', customer: 'Steel Supplier Ltd.', salesperson: 'Karim Mia', purpose: 'Supplier meeting', visit_type: 'purchase', outcome: 'Positive', visit_date: '2026-08-09', next_visit: '2026-08-16', notes: 'Negotiated 5% discount on bulk steel', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'VIS-00007', customer: 'Cement Corp.', salesperson: 'Karim Mia', purpose: 'Vendor audit', visit_type: 'purchase', outcome: 'Completed', visit_date: '2026-08-07', notes: 'Supplier audit cleared', created_at: new Date(Date.now() - 4*86400000).toISOString() },
    { id: 'VIS-00008', customer: 'Metro Construction', salesperson: 'Sakib Hasan', purpose: 'Quality inspection', visit_type: 'quality_control', outcome: 'Pending', visit_date: '2026-08-10', notes: 'Samples collected for lab testing', created_at: new Date(Date.now() - 1*86400000).toISOString() },
  ]);
  writeJSON('targets', [
    { salesperson: 'Sohag Hossain', month: '2026-08', targetSales: 800000, targetVisits: 20, targetNewCustomers: 5 },
    { salesperson: 'Sakib Hasan', month: '2026-08', targetSales: 600000, targetVisits: 18, targetNewCustomers: 4 },
    { salesperson: 'Rafiq Islam', month: '2026-08', targetSales: 500000, targetVisits: 15, targetNewCustomers: 3 },
    { salesperson: 'Nisha Akter', month: '2026-08', targetSales: 400000, targetVisits: 12, targetNewCustomers: 3 },
  ]);
}

// ============ AUTH ENDPOINTS ============
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 10, 60000)) return res.status(429).json({ error: 'Too many attempts.' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  const accs = readJSON('accounts');
  const user = accs.find(a => a.username === username);
  if (!user || !verifyPassword(password, user.password)) {
    console.log(`[AUDIT] LOGIN_FAIL: ${username}`);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const token = createSession(user.username, user.role);
  console.log(`[AUDIT] LOGIN_OK: ${username}`);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/logout', authRequired, (req, res) => {
  sessions.delete(req.headers.authorization.slice(7));
  res.json({ success: true });
});

app.get('/api/session', authRequired, (req, res) => {
  const accs = readJSON('accounts');
  const user = accs.find(a => a.username === req.session.username);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: sanitizeUser(user) });
});

// ============ DASHBOARD ============
app.get('/api/dashboard/stats', authRequired, async (req, res) => {
  const customers = readJSON('customers');
  const leads = readJSON('leads');
  const opportunities = readJSON('opportunities');
  const orders = readJSON('orders');
  const complaints = readJSON('complaints');
  const visits = readJSON('visits');
  const targets = readJSON('targets');
  const accounts = readJSON('accounts');

  const now = new Date();
  const thisMonth = now.getMonth(); const thisYear = now.getFullYear();
  let newThisMonth = customers.filter(c => { const d = new Date(c.created_at); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; }).length;
  let pipelineValue = opportunities.filter(o => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').reduce((s, o) => s + (o.value || 0), 0);
  let pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'processing').length;
  let totalSales = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0);
  let openLeads = leads.filter(l => l.status !== 'lost' && l.status !== 'converted').length;

  const spPerformance = accounts.filter(a => a.role === 'so' || a.role === 'sales_head').map(sp => {
    const spCusts = customers.filter(c => c.salesperson === sp.name).length;
    const spVisits = visits.filter(v => v.salesperson === sp.name).length;
    const spOrders = orders.filter(o => o.salesperson === sp.name);
    const spAchieved = spOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0);
    const target = targets.find(t => t.salesperson === sp.name && t.month.startsWith(`${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`));
    const targetSales = target ? target.targetSales : 0;
    const pct = targetSales > 0 ? Math.round((spAchieved / targetSales) * 100) : null;
    let ai = 'No target set.';
    if (pct !== null) {
      if (pct >= 110) ai = 'Territory expansion recommended.';
      else if (pct >= 90) ai = 'Sustain + upsell to existing customers.';
      else if (pct >= 70) ai = 'Prioritize lead follow-ups and conversions.';
      else if (pct >= 50) ai = 'Increase visits and re-engage dormant accounts.';
      else ai = 'Coaching session recommended.';
    }
    return { name: sp.name, username: sp.username, role: sp.role, territory: sp.territory, customers: spCusts, visits: spVisits, targetSales, achievedSales: spAchieved, pct, aiSuggestion: ai };
  }).sort((a, b) => (b.pct || -1) - (a.pct || -1));

  // Real financial data from SQL Server
  let financial = null;
  try {
    financial = await runQuery(`
      SELECT SUM(CASE WHEN numAmount < 0 THEN ABS(numAmount) ELSE 0 END) as totalRevenue,
        SUM(CASE WHEN strFSComponentName = 'Cost Of Goods Sold' THEN numAmount ELSE 0 END) as cogs,
        SUM(CASE WHEN strFSComponentName IN ('Manufacturing Overhead/Cost of Service Provided','Logistics & Distribution Expenses','Selling Expenses','Administrative Expenses','Marketing Expenses','Depreciation Expenses') THEN numAmount ELSE 0 END) as opex,
        SUM(CASE WHEN strFSComponentName = 'Financial Expenses' THEN numAmount ELSE 0 END) as financialExp,
        SUM(CASE WHEN strFSComponentName = 'Provission For Income Tax' THEN numAmount ELSE 0 END) as tax,
        SUM(numAmount) as netIncome,
        COUNT(*) as totalTx
      FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId = ${BU_ID}
    `);
  } catch (e) { console.log('SQL Error (non-fatal):', e.message); }

  let realCustomerCount = customers.length;
  let realOrderCount = orders.length;
  let realPendingOrders = pendingOrders;
  let realTotalSales = totalSales;
  try {
    const dwhCount = await runDWHQuery(`SELECT COUNT(*) as cnt FROM prt.tblBusinessPartnerArc WHERE intBusinessUnitId=${BU_ID} AND isActive=1 AND strPartnerSalesType='Customer'`);
    if (dwhCount && dwhCount[0]) realCustomerCount = dwhCount[0].cnt;
    const ordStats = await runDWHQuery(`SELECT COUNT(*) as total_orders, SUM(numTotalOrderValue) as total_sales, SUM(CASE WHEN isCompleted=0 THEN 1 ELSE 0 END) as pending FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=${BU_ID}`);
    if (ordStats && ordStats[0]) {
      realOrderCount = ordStats[0].total_orders;
      realTotalSales = ordStats[0].total_sales || 0;
      realPendingOrders = ordStats[0].pending || 0;
    }
    openLeads = realPendingOrders;
    const pipelineSum = await runDWHQuery(`SELECT SUM(numTotalOrderValue) as total FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=${BU_ID} AND isCompleted=0 AND isApproved=1 AND isRejected=0`);
    if (pipelineSum && pipelineSum[0]) pipelineValue = pipelineSum[0].total || 0;
  } catch(e) {}

  res.json({
    kpi: { totalCustomers: realCustomerCount, newThisMonth, openLeads, pipelineValue, pendingOrders: realPendingOrders, totalOrders: realOrderCount, totalSales: realTotalSales, openComplaints: complaints.filter(c => c.status === 'open').length, totalVisits: visits.length },
    spPerformance,
    financial: financial ? financial[0] : null,
    buInfo: { code: 'NTL', id: 211, name: 'Nobayon Traders Ltd.', group: 'Trading', subGroup: 'Non Food', taxRate: 25 }
  });
});

// ============ FINANCIAL ANALYTICS ============
app.get('/api/financial/summary', authRequired, async (req, res) => {
  try { const d = await runQuery(`SELECT SUM(CASE WHEN numAmount<0 THEN ABS(numAmount) ELSE 0 END) as totalRevenue, SUM(CASE WHEN strFSComponentName='Cost Of Goods Sold' THEN numAmount ELSE 0 END) as cogs, SUM(CASE WHEN strFSComponentName IN ('Manufacturing Overhead/Cost of Service Provided','Logistics & Distribution Expenses','Selling Expenses','Administrative Expenses','Marketing Expenses','Depreciation Expenses') THEN numAmount ELSE 0 END) as opex, SUM(CASE WHEN strFSComponentName='Financial Expenses' THEN numAmount ELSE 0 END) as financialExp, SUM(CASE WHEN strFSComponentName='Provission For Income Tax' THEN numAmount ELSE 0 END) as tax, SUM(numAmount) as netIncome, COUNT(*) as totalTx, COUNT(DISTINCT strSubGLName) as glAccounts, COUNT(DISTINCT strProfitCenterName) as profitCenters FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=${BU_ID}`); res.json(d[0]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/fs-components', authRequired, async (req, res) => {
  try { const d = await runQuery(`SELECT strFSComponentName as name, strType as type, COUNT(*) as txCount, SUM(numAmount) as totalAmount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=${BU_ID} GROUP BY strFSComponentName, strType ORDER BY totalAmount ASC`); res.json(d); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/monthly', authRequired, async (req, res) => {
  try { const d = await runQuery(`SELECT FORMAT(dteTransactionDate,'yyyy-MM') as month, SUM(CASE WHEN numAmount<0 THEN ABS(numAmount) ELSE 0 END) as revenue, SUM(CASE WHEN strFSComponentName='Cost Of Goods Sold' THEN numAmount ELSE 0 END) as cogs, SUM(CASE WHEN numAmount>0 AND strFSComponentName!='Cost Of Goods Sold' THEN numAmount ELSE 0 END) as expenses, SUM(numAmount) as netIncome, COUNT(*) as txCount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=${BU_ID} GROUP BY FORMAT(dteTransactionDate,'yyyy-MM') ORDER BY month`); res.json(d); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/top-gl', authRequired, async (req, res) => {
  try { const d = await runQuery(`SELECT TOP 30 strSubGLName as name, strGeneralLedgerName as glName, strFSComponentName as component, COUNT(*) as txCount, SUM(numAmount) as totalAmount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=${BU_ID} GROUP BY strSubGLName, strGeneralLedgerName, strFSComponentName ORDER BY ABS(SUM(numAmount)) DESC`); res.json(d); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/transactions', authRequired, async (req, res) => {
  try { const lim = parseInt(req.query.limit) || 100; const d = await runQuery(`SELECT TOP ${lim} dteTransactionDate as date, strFSComponentName as component, strGeneralLedgerName as glName, strSubGLName as subGL, strProfitCenterName as profitCenter, numAmount as amount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=${BU_ID} ORDER BY dteTransactionDate DESC`); res.json(d); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ ACCOUNTS (with team management) ============
app.get('/api/accounts', authRequired, (req, res) => {
  res.json(sanitizeAccounts(readJSON('accounts')));
});

app.post('/api/accounts', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  const accs = readJSON('accounts');
  const { username, password, role, name, territory, supervisor } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (accs.find(a => a.username === username)) return res.status(400).json({ error: 'Username exists' });
  const nu = { id: nextId('ACC'), username, password: hashPassword(password), name: name || username, role: role || 'so', territory: territory || '', supervisor: supervisor || '', created_at: new Date().toISOString() };
  accs.push(nu); writeJSON('accounts', accs);
  res.status(201).json(sanitizeUser(nu));
});

app.put('/api/accounts/:username', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), (req, res) => {
  const accs = readJSON('accounts');
  const idx = accs.findIndex(a => a.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { password, ...updates } = req.body;
  if (req.session.role === 'sales_head') {
    const requester = accs.find(a => a.username === req.session.username);
    if (accs[idx].supervisor !== requester.username && accs[idx].supervisor !== '') return res.status(403).json({ error: 'Can only manage your own team' });
    accs[idx] = { ...accs[idx], supervisor: updates.supervisor, territory: updates.territory };
  } else {
    accs[idx] = { ...accs[idx], ...updates };
  }
  if (password) accs[idx].password = hashPassword(password);
  writeJSON('accounts', accs);
  res.json(sanitizeUser(accs[idx]));
});

app.delete('/api/accounts/:username', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  let accs = readJSON('accounts');
  const idx = accs.findIndex(a => a.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (accs[idx].username === req.session.username) return res.status(400).json({ error: 'Cannot delete yourself' });
  accs.splice(idx, 1); writeJSON('accounts', accs);
  res.json({ success: true });
});

// ============ TARGETS ============
app.get('/api/targets', authRequired, (req, res) => res.json(readJSON('targets')));
app.post('/api/targets', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), (req, res) => {
  const t = readJSON('targets');
  const nt = { id: nextId('TGT'), ...req.body, created_at: new Date().toISOString() };
  t.push(nt); writeJSON('targets', t);
  res.status(201).json(nt);
});
app.put('/api/targets/:id', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), (req, res) => {
  const t = readJSON('targets'); const i = t.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  t[i] = { ...t[i], ...req.body }; writeJSON('targets', t); res.json(t[i]);
});
app.delete('/api/targets/:id', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  let t = readJSON('targets'); t = t.filter(x => x.id !== req.params.id); writeJSON('targets', t); res.json({ success: true });
});

// ============ CRUD ROUTES ============
// ============ REAL CUSTOMERS FROM DWH ============
app.get('/api/customers/dwh', authRequired, async (req, res) => {
  try {
    const raw = await runDWHQuery(`SELECT strBusinessPartnerName as name, strContactNumber as phone, strEmail as email, strBusinessPartnerAddress as address, strPartnerSalesType as partner_type, strDistrictName as district, isActive, strBIN as bin, strBusinessPartnerCode as code, dteLastActionDateTime as last_active FROM prt.tblBusinessPartnerArc WHERE intBusinessUnitId=${BU_ID} AND isActive=1 AND strPartnerSalesType='Customer' ORDER BY strBusinessPartnerName`);
    const mapped = raw.map((r, i) => ({
      id: 'BP-' + String(i + 1).padStart(4, '0'),
      name: r.name || 'Unknown',
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      salesperson: r.partner_type || '',
      status: r.isActive ? 'active' : 'inactive',
      source: r.district || '',
      code: r.code || '',
      bin: r.bin || '',
      last_active: r.last_active ? new Date(r.last_active).toLocaleDateString('en-BD') : ''
    }));
    res.json(mapped);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

crudRoutes('customers', 'customers');
// ============ REAL LEADS FROM DWH ============
app.get('/api/leads/dwh', authRequired, async (req, res) => {
  try {
    const raw = await runDWHQuery(`SELECT h.strSalesOrderCode, h.dteSalesOrderDate, h.strSoldToPartnerName as customer, h.strSoldToPartnerAddress, h.numTotalOrderValue as value, h.isCompleted, h.isApproved, h.isRejected, h.strPaymentTermsName, h.strSalesOfficeName, h.strSalesOrganizationName, p.strContactNumber as phone, p.strEmail as email, p.strDistrictName FROM oms.tblSalesOrderHeaderArc h LEFT JOIN prt.tblBusinessPartnerArc p ON h.strSoldToPartnerName = p.strBusinessPartnerName AND p.intBusinessUnitId=h.intBusinessUnitId WHERE h.intBusinessUnitId=${BU_ID} AND h.isCompleted=0 ORDER BY h.dteSalesOrderDate DESC`);
    const mapped = raw.map((r, i) => ({
      id: 'L-' + String(i + 1).padStart(4, '0'),
      name: r.customer || 'Unknown',
      phone: r.phone || '',
      email: r.email || '',
      source: r.strDistrictName || '',
      status: r.isRejected ? 'lost' : (r.isApproved ? 'qualified' : 'new'),
      salesperson: r.strSalesOfficeName || '',
      supervisor: 'Kazi Sibbir Ahammad (CBO)',
      notes: `${r.strPaymentTermsName || 'N/A'} | ${r.strSalesOrderCode}`,
      value: r.value || 0
    }));
    res.json(mapped);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ REAL EMPLOYEES / SALES TEAM FROM DWH ============
app.get('/api/employees/dwh', authRequired, async (req, res) => {
  try {
    const raw = await runDWHQuery(`SELECT e.strEmployeeName as name, d.strDesignation as designation, e.strEmployeeCode as code, e.isActive, sup.strEmployeeName as supervisor, supd.strDesignation as supervisor_role, lm.strEmployeeName as line_manager, lmd.strDesignation as lm_role FROM saas.empEmployeeBasicInfoArc e JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc sup ON e.intSupervisorId = sup.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc supd ON sup.intDesignationId = supd.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc lm ON e.intLineManagerId = lm.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc lmd ON lm.intDesignationId = lmd.intDesignationId WHERE e.intBusinessUnitId=${BU_ID} AND e.isActive=1 ORDER BY sup.strEmployeeName, e.strEmployeeName`);
    res.json(raw);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

crudRoutes('leads', 'leads');
// ============ REAL OPPORTUNITIES FROM DWH ============
app.get('/api/opportunities/dwh', authRequired, async (req, res) => {
  try {
    const raw = await runDWHQuery(`SELECT TOP 200 strSalesOrderCode, dteSalesOrderDate, strSoldToPartnerName as customer, strSoldToPartnerAddress, numTotalOrderValue as value, isCompleted, isApproved, isRejected, strPaymentTermsName, strSalesOfficeName, dteDueShippingDate FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=${BU_ID} AND (isCompleted=0 OR isRejected=1 OR numTotalOrderValue > 5000000) ORDER BY numTotalOrderValue DESC`);
    const mapped = raw.map((r, i) => ({
      id: 'OPP-' + String(i + 1).padStart(4, '0'),
      name: r.customer + ' - ' + r.strSalesOrderCode,
      customer: r.customer || 'Unknown',
      salesperson: r.strSalesOfficeName || '',
      stage: r.isCompleted ? 'Closed Won' : (r.isRejected ? 'Closed Lost' : 'Negotiation'),
      value: r.value || 0,
      probability: r.isCompleted ? 100 : (r.isApproved ? 70 : 30),
      expected_close: r.dteDueShippingDate ? new Date(r.dteDueShippingDate).toISOString().slice(0,10) : ''
    }));
    res.json(mapped);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

crudRoutes('opportunities', 'opportunities');
// ============ REAL ORDERS FROM DWH ============
app.get('/api/orders/dwh', authRequired, async (req, res) => {
  try {
    const raw = await runDWHQuery(`SELECT TOP 500 h.strSalesOrderCode as order_code, h.dteSalesOrderDate as order_date, h.strSoldToPartnerName as customer, h.strSoldToPartnerAddress as address, h.numTotalOrderValue as total, h.numNetOrderValue as net_value, h.isCompleted, h.isApproved, h.strPaymentTermsName as payment_terms, h.strSalesOfficeName as sales_office, h.strSalesOrganizationName as sales_org, h.strShippointName as ship_point, h.dteDueShippingDate as due_date, r.strItemName as product, r.numOrderQuantity as quantity, r.numItemPrice as unit_price, r.strUOM as uom FROM oms.tblSalesOrderHeaderArc h LEFT JOIN oms.tblSalesOrderRowArc r ON h.intSalesOrderId = r.intSalesOrderId AND r.intSequenceNo = 1 WHERE h.intBusinessUnitId = ${BU_ID} ORDER BY h.dteSalesOrderDate DESC`);
    const mapped = raw.map((r, i) => ({
      id: 'SO-' + String(i + 1).padStart(5, '0'),
      customer: r.customer || 'Unknown',
      salesperson: r.sales_office || '',
      product: r.product || '',
      quantity: r.quantity || 0,
      unit_price: r.unit_price || 0,
      total: r.total || r.net_value || 0,
      status: r.isCompleted ? 'delivered' : (r.isApproved ? 'processing' : 'pending'),
      order_date: r.order_date ? new Date(r.order_date).toISOString().slice(0,10) : '',
      delivery_date: r.due_date ? new Date(r.due_date).toISOString().slice(0,10) : '',
      payment_terms: r.payment_terms || '',
      ship_point: r.ship_point || '',
      uom: r.uom || ''
    }));
    res.json(mapped);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

crudRoutes('orders', 'orders');
// ============ REAL COMPLAINTS FROM DWH ============
app.get('/api/complaints/dwh', authRequired, async (req, res) => {
  try {
    const raw = await runDWHQuery(`SELECT TOP 200 intSalesReturnId, strSalesOrderNo, strDeliveryChallan, strBusinessPartnerName as customer, strPlantName, strWarehouseName, dteReturnDateTime, numTotalReturnQty, strReassons as reason, isActive, isClosed, strAttachment FROM sms.tblSalesReturnHeaderArc WHERE intBusinessUnitId=${BU_ID} ORDER BY dteReturnDateTime DESC`);
    const mapped = raw.map((r, i) => ({
      id: 'CMP-' + String(i + 1).padStart(4, '0'),
      customer: r.customer || 'Unknown',
      subject: 'Return: ' + (r.strSalesOrderNo || r.strDeliveryChallan || 'N/A'),
      description: r.reason || 'Sales return from ' + r.strPlantName + ', Qty: ' + (r.numTotalReturnQty || 0),
      priority: (r.numTotalReturnQty > 50) ? 'high' : (r.numTotalReturnQty > 10 ? 'medium' : 'low'),
      status: r.isClosed ? 'resolved' : (r.isActive ? 'open' : 'in_progress'),
      assigned_to: r.strWarehouseName || r.strPlantName || 'Trading Sales'
    }));
    res.json(mapped);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

crudRoutes('complaints', 'complaints');
crudRoutes('visits', 'visits');

// ============ CHANGE PASSWORD ============
app.post('/api/change-password', authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  const accs = readJSON('accounts');
  const idx = accs.findIndex(a => a.username === req.session.username);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(currentPassword, accs[idx].password)) return res.status(400).json({ error: 'Current password incorrect' });
  accs[idx].password = hashPassword(newPassword);
  writeJSON('accounts', accs);
  console.log(`[AUDIT] PASSWORD_CHANGE: ${req.session.username}`);
  res.json({ success: true });
});

// ============ GOOGLE LOGIN ============
app.post('/api/google-login', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const accs = readJSON('accounts');
  const user = accs.find(a => (a.username && a.username.toLowerCase().includes(email.toLowerCase())) || (a.email && a.email.toLowerCase() === email.toLowerCase()));
  if (!user) return res.status(401).json({ error: 'Account not found for this email' });
  const token = createSession(user.username, user.role);
  console.log(`[AUDIT] GOOGLE_LOGIN: ${user.username}`);
  res.json({ token, user: sanitizeUser(user) });
});

// ============ RESET ============
app.post('/api/reset', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  wipeDataFiles(); seedAccounts(); seedDemoData();
  res.json({ success: true });
});

// ============ INIT ============
wipeDataFiles();
seedAccounts();
seedDemoData();

// Warm up DWH connection
setTimeout(async () => {
  try { const p = await getDWHPool(); console.log('DWH warm-up: connected'); }
  catch(e) { console.log('DWH warm-up failed (non-critical):', e.message); }
}, 1000);

app.listen(PORT, () => {
  console.log(`NTL CRM - Nobayon Traders Ltd. (BU 211) running on http://localhost:${PORT}`);
  const { exec } = require('child_process');
  exec(`start http://localhost:${PORT}`);
});
