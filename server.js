const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const KEY_LEN = 64;
const SESSION_EXPIRY = 24 * 60 * 60 * 1000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(filename) {
  const filePath = path.join(DATA_DIR, filename + '.json');
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return []; }
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename + '.json'), JSON.stringify(data, null, 2));
}

function nextId(prefix) {
  const counterFile = path.join(DATA_DIR, '_counters.json');
  let counters = {};
  if (fs.existsSync(counterFile)) {
    try { counters = JSON.parse(fs.readFileSync(counterFile, 'utf-8')); } catch {}
  }
  if (!counters[prefix]) counters[prefix] = 0;
  counters[prefix]++;
  fs.writeFileSync(counterFile, JSON.stringify(counters));
  return prefix + '-' + String(counters[prefix]).padStart(5, '0');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return verify === hash;
}

const sessions = new Map();

function createSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, role, createdAt: Date.now() });
  return token;
}

function validateSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_EXPIRY) {
    sessions.delete(token);
    return null;
  }
  return session;
}

const rateLimits = new Map();

function checkRateLimit(ip, limit, windowMs) {
  const now = Date.now();
  const key = ip;
  if (!rateLimits.has(key)) rateLimits.set(key, []);
  const entries = rateLimits.get(key).filter(t => now - t < windowMs);
  entries.push(now);
  rateLimits.set(key, entries);
  return entries.length <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of rateLimits) {
    const filtered = entries.filter(t => now - t < 60000);
    if (filtered.length === 0) rateLimits.delete(key);
    else rateLimits.set(key, filtered);
  }
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_EXPIRY) sessions.delete(token);
  }
}, 60000);

function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const session = validateSession(auth.slice(7));
  if (!session) return res.status(401).json({ error: 'Session expired' });
  req.session = session;
  next();
}

function roleRequired(...roles) {
  return (req, res, next) => {
    const accounts = readJSON('accounts');
    const user = accounts.find(a => a.username === req.session.username);
    if (!user || !roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
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

function sanitizeAccounts(accounts) {
  return accounts.map(({ password, ...rest }) => rest);
}

function sanitizeUser(user) {
  const { password, ...rest } = user;
  return rest;
}

const DATA_FILES = ['customers', 'leads', 'opportunities', 'orders', 'complaints', 'visits', 'accounts'];

function wipeDataFiles() {
  DATA_FILES.forEach(f => writeJSON(f, []));
}

function crudRoutes(entityName, routePath) {
  const router = express.Router();

  router.get('/', authRequired, (req, res) => {
    let data = readJSON(entityName);
    if (entityName === 'accounts') data = sanitizeAccounts(data);
    res.json(data);
  });

  router.post('/', authRequired, (req, res) => {
    const data = readJSON(entityName);
    const idPrefix =
      entityName === 'customers' ? 'CUS' :
      entityName === 'leads' ? 'LEAD' :
      entityName === 'opportunities' ? 'OPP' :
      entityName === 'orders' ? 'ORD' :
      entityName === 'complaints' ? 'CMP' :
      entityName === 'visits' ? 'VIS' :
      entityName === 'accounts' ? 'ACC' : 'GEN';
    const newItem = { id: nextId(idPrefix), ...req.body, created_at: new Date().toISOString() };
    data.push(newItem);
    writeJSON(entityName, data);
    console.log(`[AUDIT ${new Date().toISOString()}] CREATE ${entityName}: ${newItem.id} by ${req.session.username}`);
    res.status(201).json(newItem);
  });

  router.put('/:id', authRequired, (req, res) => {
    const data = readJSON(entityName);
    const idx = data.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data[idx] = { ...data[idx], ...req.body, updated_at: new Date().toISOString() };
    writeJSON(entityName, data);
    console.log(`[AUDIT ${new Date().toISOString()}] UPDATE ${entityName}: ${req.params.id} by ${req.session.username}`);
    res.json(data[idx]);
  });

  router.delete('/:id', authRequired, (req, res) => {
    let data = readJSON(entityName);
    const idx = data.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.splice(idx, 1);
    writeJSON(entityName, data);
    console.log(`[AUDIT ${new Date().toISOString()}] DELETE ${entityName}: ${req.params.id} by ${req.session.username}`);
    res.json({ success: true });
  });

  app.use('/api/' + routePath, router);
}

function seedAccounts() {
  const accounts = [
    { id: 'ACC-00001', username: 'admin', password: hashPassword('admin123'), name: 'System Admin', role: 'super_admin', territory: 'HQ', created_at: new Date().toISOString() },
    { id: 'ACC-00002', username: 'rahim', password: hashPassword('rahim123'), name: 'Rahim Uddin', role: 'admin', territory: 'Dhaka', supervisor: 'admin', created_at: new Date().toISOString() },
    { id: 'ACC-00003', username: 'karim', password: hashPassword('karim123'), name: 'Karim Mia', role: 'sales_head', territory: 'Dhaka', supervisor: 'rahim', created_at: new Date().toISOString() },
    { id: 'ACC-00004', username: 'sohag', password: hashPassword('sohag123'), name: 'Sohag Hossain', role: 'so', territory: 'Dhaka North', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00005', username: 'sakib', password: hashPassword('sakib123'), name: 'Sakib Hasan', role: 'so', territory: 'Dhaka South', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00006', username: 'rafiq', password: hashPassword('rafiq123'), name: 'Rafiq Islam', role: 'so', territory: 'Gazipur', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00007', username: 'nisha', password: hashPassword('nisha123'), name: 'Nisha Akter', role: 'so', territory: 'Narayanganj', supervisor: 'karim', created_at: new Date().toISOString() },
    { id: 'ACC-00008', username: 'ccenter', password: hashPassword('ccenter123'), name: 'Contact Center', role: 'contact_center', territory: 'HQ', created_at: new Date().toISOString() },
    { id: 'ACC-00009', username: 'excellence', password: hashPassword('excel123'), name: 'Sales Excellence', role: 'sales_excellence', territory: 'HQ', created_at: new Date().toISOString() },
    { id: 'ACC-00010', username: 'mgmt', password: hashPassword('mgmt123'), name: 'Management User', role: 'management', territory: 'HQ', created_at: new Date().toISOString() }
  ];
  writeJSON('accounts', accounts);
}

function seedDemoData() {
  const customers = [
    { id: 'CUS-00001', name: 'BuildMart Ltd.', phone: '01710000001', email: 'info@buildmart.com', address: '123 Gulshan Ave, Dhaka', salesperson: 'Sohag Hossain', status: 'active', source: 'Referral', created_at: new Date(Date.now() - 30*86400000).toISOString() },
    { id: 'CUS-00002', name: 'SteelCraft Industries', phone: '01710000002', email: 'contact@steelcraft.com', address: '45 Tejgaon I/A, Dhaka', salesperson: 'Sohag Hossain', status: 'active', source: 'Walk-in', created_at: new Date(Date.now() - 25*86400000).toISOString() },
    { id: 'CUS-00003', name: 'GreenBuild Developers', phone: '01710000003', email: 'sales@greenbuild.com', address: '78 Banani, Dhaka', salesperson: 'Sakib Hasan', status: 'active', source: 'Website', created_at: new Date(Date.now() - 20*86400000).toISOString() },
    { id: 'CUS-00004', name: 'Metro Construction', phone: '01710000004', email: 'info@metrocon.com', address: '12 Mirpur Rd, Dhaka', salesperson: 'Sakib Hasan', status: 'active', source: 'Trade Show', created_at: new Date(Date.now() - 15*86400000).toISOString() },
    { id: 'CUS-00005', name: 'Prime Builders', phone: '01710000005', email: 'hello@primebuilders.com', address: '56 Uttara, Dhaka', salesperson: 'Sakib Hasan', status: 'inactive', source: 'Cold Call', created_at: new Date(Date.now() - 10*86400000).toISOString() },
    { id: 'CUS-00006', name: 'Akij Ceramics Dealer', phone: '01710000006', email: 'dealer@akij.com', address: '34 Motijheel, Dhaka', salesperson: 'Rafiq Islam', status: 'active', source: 'Existing', created_at: new Date(Date.now() - 8*86400000).toISOString() },
    { id: 'CUS-00007', name: 'National Housing', phone: '01710000007', email: 'info@nationalhousing.com', address: '90 Dhanmondi, Dhaka', salesperson: 'Rafiq Islam', status: 'active', source: 'Referral', created_at: new Date(Date.now() - 5*86400000).toISOString() },
    { id: 'CUS-00008', name: 'City Developers Ltd.', phone: '01710000008', email: 'admin@citydev.com', address: '23 Bashundhara, Dhaka', salesperson: 'Nisha Akter', status: 'lead', source: 'Website', created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'CUS-00009', name: 'Sunrise Properties', phone: '01710000009', email: 'care@sunriseprop.com', address: '67 Baridhara, Dhaka', salesperson: 'Nisha Akter', status: 'active', source: 'Social Media', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'CUS-00010', name: 'Mega Infra Ltd.', phone: '01710000010', email: 'info@megainfra.com', address: '88 Gulshan-2, Dhaka', salesperson: 'Sohag Hossain', status: 'lead', source: 'EMail Campaign', created_at: new Date().toISOString() }
  ];
  writeJSON('customers', customers);

  const leads = [
    { id: 'LEAD-00001', name: 'Alam Group', phone: '01720000001', email: 'alam@group.com', source: 'Website', status: 'new', salesperson: 'Sohag Hossain', notes: 'Interested in bulk cement', value: 500000, created_at: new Date(Date.now() - 5*86400000).toISOString() },
    { id: 'LEAD-00002', name: 'Bismillah Traders', phone: '01720000002', email: 'bismillah@traders.com', source: 'Referral', status: 'contacted', salesperson: 'Sakib Hasan', notes: 'Needs steel rods quote', value: 300000, created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'LEAD-00003', name: 'Chowdhury Enterprise', phone: '01720000003', email: 'chowdhury@ent.com', source: 'Walk-in', status: 'qualified', salesperson: 'Rafiq Islam', notes: 'Ready to sign', value: 800000, created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'LEAD-00004', name: 'Dhaka Mega Mart', phone: '01720000004', email: 'dmart@dm.com', source: 'Trade Show', status: 'new', salesperson: 'Nisha Akter', notes: 'Cement and tiles', value: 1200000, created_at: new Date(Date.now() - 1*86400000).toISOString() },
    { id: 'LEAD-00005', name: 'Eastern Suppliers', phone: '01720000005', email: 'eastern@supply.com', source: 'Cold Call', status: 'lost', salesperson: 'Sohag Hossain', notes: 'Went with competitor', value: 200000, created_at: new Date().toISOString() }
  ];
  writeJSON('leads', leads);

  const opportunities = [
    { id: 'OPP-00001', name: 'BuildMart Cement Supply', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', stage: 'Negotiation', value: 800000, probability: 70, expected_close: '2026-09-15', created_at: new Date(Date.now() - 10*86400000).toISOString() },
    { id: 'OPP-00002', name: 'SteelCraft Rods Deal', customer: 'SteelCraft Industries', salesperson: 'Sohag Hossain', stage: 'Proposal', value: 1200000, probability: 50, expected_close: '2026-10-01', created_at: new Date(Date.now() - 8*86400000).toISOString() },
    { id: 'OPP-00003', name: 'GreenBuild Tiles Order', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', stage: 'Qualification', value: 500000, probability: 30, expected_close: '2026-09-30', created_at: new Date(Date.now() - 5*86400000).toISOString() },
    { id: 'OPP-00004', name: 'Metro Sanitary Ware', customer: 'Metro Construction', salesperson: 'Sakib Hasan', stage: 'Closed Won', value: 350000, probability: 100, expected_close: '2026-08-15', created_at: new Date(Date.now() - 12*86400000).toISOString() }
  ];
  writeJSON('opportunities', opportunities);

  const orders = [
    { id: 'ORD-00001', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', product: 'Cement OPC 50kg', quantity: 500, unit_price: 420, total: 210000, status: 'delivered', order_date: '2026-08-01', delivery_date: '2026-08-05', created_at: new Date(Date.now() - 10*86400000).toISOString() },
    { id: 'ORD-00002', customer: 'SteelCraft Industries', salesperson: 'Sohag Hossain', product: 'Steel Rods 60 Grade', quantity: 200, unit_price: 850, total: 170000, status: 'pending', order_date: '2026-08-03', created_at: new Date(Date.now() - 8*86400000).toISOString() },
    { id: 'ORD-00003', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', product: 'Ceramic Tiles', quantity: 1000, unit_price: 55, total: 55000, status: 'processing', order_date: '2026-08-05', created_at: new Date(Date.now() - 6*86400000).toISOString() },
    { id: 'ORD-00004', customer: 'Metro Construction', salesperson: 'Sakib Hasan', product: 'Sanitary Ware Set', quantity: 50, unit_price: 1200, total: 60000, status: 'delivered', order_date: '2026-08-07', delivery_date: '2026-08-09', created_at: new Date(Date.now() - 4*86400000).toISOString() },
    { id: 'ORD-00005', customer: 'Akij Ceramics Dealer', salesperson: 'Rafiq Islam', product: 'Tiles Premium', quantity: 2000, unit_price: 65, total: 130000, status: 'pending', order_date: '2026-08-10', created_at: new Date(Date.now() - 1*86400000).toISOString() }
  ];
  writeJSON('orders', orders);

  const complaints = [
    { id: 'CMP-00001', customer: 'Prime Builders', subject: 'Delayed delivery', description: 'Order not delivered on promised date', priority: 'high', status: 'open', assigned_to: 'Contact Center', created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'CMP-00002', customer: 'City Developers Ltd.', subject: 'Product quality issue', description: 'Tiles have color variation', priority: 'medium', status: 'in_progress', assigned_to: 'Contact Center', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'CMP-00003', customer: 'Metro Construction', subject: 'Billing discrepancy', description: 'Invoice amount does not match PO', priority: 'low', status: 'resolved', assigned_to: 'Contact Center', created_at: new Date(Date.now() - 5*86400000).toISOString() }
  ];
  writeJSON('complaints', complaints);

  const visits = [
    { id: 'VIS-00001', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', purpose: 'Follow-up', outcome: 'Positive', visit_date: '2026-08-10', next_visit: '2026-08-17', created_at: new Date(Date.now() - 1*86400000).toISOString() },
    { id: 'VIS-00002', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', purpose: 'New product intro', outcome: 'Interested', visit_date: '2026-08-09', next_visit: '2026-08-20', created_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'VIS-00003', customer: 'Akij Ceramics Dealer', salesperson: 'Rafiq Islam', purpose: 'Order collection', outcome: 'Completed', visit_date: '2026-08-08', created_at: new Date(Date.now() - 3*86400000).toISOString() },
    { id: 'VIS-00004', customer: 'National Housing', salesperson: 'Rafiq Islam', purpose: 'Site inspection', outcome: 'Positive', visit_date: '2026-08-11', next_visit: '2026-08-25', created_at: new Date().toISOString() },
    { id: 'VIS-00005', customer: 'Sunrise Properties', salesperson: 'Nisha Akter', purpose: 'Product demo', outcome: 'Interested', visit_date: '2026-08-11', created_at: new Date().toISOString() }
  ];
  writeJSON('visits', visits);

  writeJSON('targets', [
    { salesperson: 'Sohag Hossain', month: '2026-08', targetSales: 800000, targetVisits: 20, targetNewCustomers: 5 },
    { salesperson: 'Sakib Hasan', month: '2026-08', targetSales: 600000, targetVisits: 18, targetNewCustomers: 4 },
    { salesperson: 'Rafiq Islam', month: '2026-08', targetSales: 500000, targetVisits: 15, targetNewCustomers: 3 },
    { salesperson: 'Nisha Akter', month: '2026-08', targetSales: 400000, targetVisits: 12, targetNewCustomers: 3 }
  ]);
}

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 10, 60000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  const accounts = readJSON('accounts');
  const user = accounts.find(a => a.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  const valid = verifyPassword(password, user.password);
  if (!valid) {
    console.log(`[AUDIT ${new Date().toISOString()}] LOGIN_FAIL: ${username}`);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = createSession(user.username, user.role);
  console.log(`[AUDIT ${new Date().toISOString()}] LOGIN_OK: ${username}`);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/logout', authRequired, (req, res) => {
  const auth = req.headers.authorization;
  sessions.delete(auth.slice(7));
  res.json({ success: true });
});

app.get('/api/session', authRequired, (req, res) => {
  const accounts = readJSON('accounts');
  const user = accounts.find(a => a.username === req.session.username);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/google-login', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const accounts = readJSON('accounts');
  const user = accounts.find(a => a.username === email || a.email === email);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  const token = createSession(user.username, user.role);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/change-password', authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const accounts = readJSON('accounts');
  const idx = accounts.findIndex(a => a.username === req.session.username);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(currentPassword, accounts[idx].password)) return res.status(400).json({ error: 'Current password incorrect' });
  accounts[idx].password = hashPassword(newPassword);
  writeJSON('accounts', accounts);
  console.log(`[AUDIT ${new Date().toISOString()}] PASSWORD_CHANGE: ${req.session.username}`);
  res.json({ success: true });
});

app.post('/api/reset', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  wipeDataFiles();
  seedAccounts();
  console.log(`[AUDIT ${new Date().toISOString()}] RESET: by ${req.session.username}`);
  res.json({ success: true });
});

app.get('/api/dashboard/stats', authRequired, (req, res) => {
  const customers = readJSON('customers');
  const leads = readJSON('leads');
  const opportunities = readJSON('opportunities');
  const orders = readJSON('orders');
  const complaints = readJSON('complaints');
  const visits = readJSON('visits');
  const targets = readJSON('targets');
  const accounts = readJSON('accounts');

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const newThisMonth = customers.filter(c => {
    const d = new Date(c.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  const pipelineValue = opportunities
    .filter(o => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost')
    .reduce((sum, o) => sum + (o.value || 0), 0);

  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'processing').length;
  const totalSales = orders
    .filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + (o.total || 0), 0);
  const openLeads = leads.filter(l => l.status !== 'lost' && l.status !== 'converted').length;

  const spPerformance = accounts
    .filter(a => a.role === 'so' || a.role === 'sales_head')
    .map(sp => {
      const spCusts = customers.filter(c => c.salesperson === sp.name).length;
      const spVisits = visits.filter(v => v.salesperson === sp.name).length;
      const spOrders = orders.filter(o => o.salesperson === sp.name);
      const spAchieved = spOrders.filter(o => o.status === 'delivered').reduce((sum, o) => sum + (o.total || 0), 0);
      const target = targets.find(t => t.salesperson === sp.name && t.month.startsWith(`${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`));
      const targetSales = target ? target.targetSales : 0;
      const pct = targetSales > 0 ? Math.round((spAchieved / targetSales) * 100) : null;

      let aiSuggestion = 'No target set. Please set monthly targets.';
      if (pct !== null) {
        if (pct >= 110) aiSuggestion = 'Exceptional performance! Consider territory expansion and mentoring juniors.';
        else if (pct >= 90) aiSuggestion = 'Great work! Focus on sustaining performance and upselling existing customers.';
        else if (pct >= 70) aiSuggestion = 'Good progress. Prioritize lead follow-ups and convert more opportunities.';
        else if (pct >= 50) aiSuggestion = 'Below target. Increase customer visits and re-engage dormant accounts.';
        else aiSuggestion = 'Needs attention. Schedule coaching session and review territory strategy.';
      }

      return {
        name: sp.name,
        username: sp.username,
        role: sp.role,
        territory: sp.territory,
        customers: spCusts,
        visits: spVisits,
        targetSales,
        achievedSales: spAchieved,
        pct,
        aiSuggestion
      };
    })
    .sort((a, b) => (b.pct || -1) - (a.pct || -1));

  res.json({
    kpi: {
      totalCustomers: customers.length,
      newThisMonth,
      openLeads,
      pipelineValue,
      pendingOrders,
      totalSales,
      openComplaints: complaints.filter(c => c.status === 'open').length,
      totalVisits: visits.length
    },
    spPerformance
  });
});

app.get('/api/accounts', authRequired, (req, res) => {
  const accounts = readJSON('accounts');
  res.json(sanitizeAccounts(accounts));
});

app.post('/api/accounts', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  const accounts = readJSON('accounts');
  const { username, password, role, name, territory, supervisor } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (accounts.find(a => a.username === username)) return res.status(400).json({ error: 'Username already exists' });

  const newUser = {
    id: nextId('ACC'),
    username,
    password: hashPassword(password),
    name: name || username,
    role: role || 'so',
    territory: territory || '',
    supervisor: supervisor || '',
    created_at: new Date().toISOString()
  };
  accounts.push(newUser);
  writeJSON('accounts', accounts);
  console.log(`[AUDIT ${new Date().toISOString()}] CREATE account: ${username} by ${req.session.username}`);
  res.status(201).json(sanitizeUser(newUser));
});

app.put('/api/accounts/:username', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), (req, res) => {
  const accounts = readJSON('accounts');
  const idx = accounts.findIndex(a => a.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });

  const { password, ...updates } = req.body;

  if (req.session.role === 'sales_head') {
    const requester = accounts.find(a => a.username === req.session.username);
    if (accounts[idx].supervisor !== requester.username && accounts[idx].supervisor !== '') {
      return res.status(403).json({ error: 'Can only manage your own team members' });
    }
    const allowedFields = { supervisor: updates.supervisor, territory: updates.territory };
    accounts[idx] = { ...accounts[idx], ...allowedFields };
  } else {
    accounts[idx] = { ...accounts[idx], ...updates };
  }

  if (password) accounts[idx].password = hashPassword(password);
  writeJSON('accounts', accounts);
  console.log(`[AUDIT ${new Date().toISOString()}] UPDATE account: ${req.params.username} by ${req.session.username}`);
  res.json(sanitizeUser(accounts[idx]));
});

app.delete('/api/accounts/:username', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  let accounts = readJSON('accounts');
  const idx = accounts.findIndex(a => a.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (accounts[idx].username === req.session.username) return res.status(400).json({ error: 'Cannot delete your own account' });
  accounts.splice(idx, 1);
  writeJSON('accounts', accounts);
  console.log(`[AUDIT ${new Date().toISOString()}] DELETE account: ${req.params.username} by ${req.session.username}`);
  res.json({ success: true });
});

crudRoutes('customers', 'customers');
crudRoutes('leads', 'leads');
crudRoutes('opportunities', 'opportunities');
crudRoutes('orders', 'orders');
crudRoutes('complaints', 'complaints');
crudRoutes('visits', 'visits');

app.get('/api/targets', authRequired, (req, res) => {
  res.json(readJSON('targets'));
});

app.post('/api/targets', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), (req, res) => {
  const targets = readJSON('targets');
  const newTarget = { id: nextId('TGT'), ...req.body, created_at: new Date().toISOString() };
  targets.push(newTarget);
  writeJSON('targets', targets);
  res.status(201).json(newTarget);
});

app.put('/api/targets/:id', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), (req, res) => {
  const targets = readJSON('targets');
  const idx = targets.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  targets[idx] = { ...targets[idx], ...req.body };
  writeJSON('targets', targets);
  res.json(targets[idx]);
});

app.delete('/api/targets/:id', authRequired, roleRequired('super_admin', 'admin'), (req, res) => {
  let targets = readJSON('targets');
  targets = targets.filter(t => t.id !== req.params.id);
  writeJSON('targets', targets);
  res.json({ success: true });
});

wipeDataFiles();
seedAccounts();
seedDemoData();

app.listen(PORT, () => {
  console.log(`AKIJ CRM running on http://localhost:${PORT}`);
});
