const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

let sql = null;
try { sql = require('mssql'); } catch (e) { console.log('mssql not available:', e.message); }

// Google Sheets sales data URL
const GSHEETS_URL = 'https://docs.google.com/spreadsheets/d/1k3YNf8tCu3DyFpBZOFWjvByEpFYQVkf5/export?format=csv';
const LEADS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1i9SSECOfGMwAYe9dOEndLZK3P-p2XjBb0iNdD7OaJX4/export?format=csv';
let salesCache = null;
let salesCacheTime = 0;
const SALES_CACHE_MS = 10 * 60 * 1000;
let soSalesmanMap = null;
let soSalesmanMapTime = 0;
let prospectLeadsCache = null;
let prospectLeadsCacheTime = 0;

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
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

function fetchGoogleSheet() {
  return fetchGoogleSheetWithUrl(GSHEETS_URL);
}

function fetchGoogleSheetWithUrl(url) {
  return new Promise((resolve, reject) => {
    const request = (u, redirects) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          request(res.headers.location, redirects + 1);
          return;
        }
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    };
    request(url, 0);
  });
}

const SALESMAN_DESIGNATIONS = {
  'Kazi Shibbir Ahamed': 'Chief Business Officer',
  'Kazi Shibbir Ahammad': 'Chief Business Officer',
  'Kazi Sibbir Ahammad': 'Chief Business Officer',
  'Shek Jasim Uddin': 'Senior Manager',
  'K.M Atiqul Islam': 'Deputy Manager',
  'K M Atiqul Islam': 'Deputy Manager',
  'Md Shoib Reza Rajib': 'Assistant Manager',
  'MD Eynul  Hoque': 'Deputy Manager',
  'MD Eynul Hoque': 'Deputy Manager',
  'Yeasin Ali Ridoy': 'Senior Officer'
};

function normalizeName(name) {
  return (name || '').toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/ltd\.?/g, 'limited')
    .replace(/pvt\.?/g, 'private')
    .replace(/pte\.?/g, '')
    .replace(/co\.?/g, 'company')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function fetchProspectLeads() {
  if (prospectLeadsCache && (Date.now() - prospectLeadsCacheTime) < SALES_CACHE_MS) return prospectLeadsCache;
  try {
    const csv = await fetchGoogleSheetWithUrl(LEADS_SHEET_URL);
    const rows = parseCSV(csv);
    const existingCustomers = readJSON('customers');
    const existingNorm = new Set();
    existingCustomers.forEach(c => {
      existingNorm.add(normalizeName(c.name));
      existingNorm.add(normalizeName(c.name).replace('limited', '').replace('private', ''));
    });

    const newLeads = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[1]) continue;
      const company = r[1].trim();
      const norm = normalizeName(company);
      const simple = norm.replace('limited', '').replace('private', '');
      let isExisting = false;
      if (existingNorm.has(norm) || existingNorm.has(simple)) {
        isExisting = true;
      } else {
        for (const ex of existingNorm) {
          if (ex.length > 3 && (norm.includes(ex) || ex.includes(norm))) { isExisting = true; break; }
        }
      }
      if (!isExisting) {
        newLeads.push({
          id: 'PROSPECT-' + String(i).padStart(4, '0'),
          name: company,
          phone: r[5] || '',
          email: r[6] || '',
          source: 'Feed Industry Prospect',
          status: 'new',
          salesperson: '',
          notes: (r[3] || '') + (r[4] ? ' (' + r[4] + ')' : '') + ' | Brand: ' + (r[2] || '') + ' | ' + (r[7] || ''),
          value: 0
        });
      }
    }
    prospectLeadsCache = newLeads;
    prospectLeadsCacheTime = Date.now();
    return newLeads;
  } catch (e) {
    console.log('Leads sheet fetch failed:', e.message);
    return prospectLeadsCache || [];
  }
}

async function getSalesPerformance() {
  if (salesCache && (Date.now() - salesCacheTime) < SALES_CACHE_MS) return salesCache;
  try {
    const csv = await fetchGoogleSheet();
    const rows = parseCSV(csv);
    const salesmen = {};
    const yearsSet = new Set();
    const monthsSet = new Set();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 23) continue;
      const salesValue = parseFloat(r[17]) || 0;
      const costValue = parseFloat(r[19]) || 0;
      const profit = parseFloat(r[20]) || 0;
      const rawSalesman = r[21] || '';
      const district = r[22] || '';
      const qty = parseFloat(r[8]) || 0;
      const month = r[13] || 'Unknown';
      const year = r[14] || 'Unknown';
      let name = rawSalesman.replace(/^\d+\s*/, '').trim();
      if (!name) continue;
      if (month !== 'Unknown') monthsSet.add(month);
      if (year !== 'Unknown') yearsSet.add(year);
      const key = name + '|' + year + '|' + month;
      if (!salesmen[key]) salesmen[key] = { name, year, month, count: 0, salesValue: 0, costValue: 0, profit: 0, qty: 0, districts: new Set() };
      salesmen[key].count++;
      salesmen[key].salesValue += salesValue;
      salesmen[key].costValue += costValue;
      salesmen[key].profit += profit;
      salesmen[key].qty += qty;
      if (district) salesmen[key].districts.add(district);
    }
    const periods = Object.values(salesmen)
      .sort((a, b) => b.salesValue - a.salesValue)
      .map(s => ({
        name: s.name,
        designation: SALESMAN_DESIGNATIONS[s.name] || 'Sales Officer',
        year: s.year,
        month: s.month,
        orders: s.count,
        qty: s.qty,
        salesValue: s.salesValue,
        costValue: s.costValue,
        profit: s.profit,
        districts: [...s.districts]
      }));
    const result = {
      periods: periods,
      years: [...yearsSet].sort().reverse(),
      months: ['January','February','March','April','May','June','July','August','September','October','November','December']
    };
    salesCache = result;
    salesCacheTime = Date.now();
    return result;
  } catch (e) {
    console.log('Google Sheets fetch failed:', e.message);
    return salesCache || { periods: [], years: [], months: [] };
  }
}

// Get SO Number -> Salesman mapping from Google Sheets
async function getSoSalesmanMap() {
  if (soSalesmanMap && (Date.now() - soSalesmanMapTime) < SALES_CACHE_MS) return soSalesmanMap;
  try {
    const csv = await fetchGoogleSheet();
    const rows = parseCSV(csv);
    const map = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 23) continue;
      const soNumber = (r[2] || '').trim();
      const rawSalesman = r[21] || '';
      let name = rawSalesman.replace(/^\d+\s*/, '').trim();
      if (!soNumber || !name) continue;
      if (!map[soNumber]) map[soNumber] = name;
    }
    soSalesmanMap = map;
    soSalesmanMapTime = Date.now();
    return map;
  } catch (e) {
    console.log('SO map fetch failed:', e.message);
    return soSalesmanMap || {};
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const KEY_LEN = 64;
const SESSION_EXPIRY = 24 * 60 * 60 * 1000;
const BU_ID = 211;
const isRender = !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);

// ============ SQL POOLS ============
let sqlFailed = isRender;
let dwhFailed = isRender;

let pool = null;
async function getPool() {
  if (!sql || sqlFailed) throw new Error('SQL not available');
  if (pool && pool.connected) return pool;
  try {
    pool = await new sql.ConnectionPool({
      server: '203.202.241.211', port: 1433, database: 'DataMart',
      user: 'mcp_user', password: 'iAOS@35o997',
      options: { encrypt: false, trustServerCertificate: true },
      connectionTimeout: 15000, requestTimeout: 30000,
      pool: { max: 5, min: 1, idleTimeoutMillis: 30000 }
    }).connect();
    console.log('DataMart connected');
    return pool;
  } catch (e) { console.log('DataMart SQL failed:', e.message); sqlFailed = true; throw e; }
}

async function runQuery(query) {
  if (!sql || sqlFailed) throw new Error('SQL not available');
  const p = await getPool();
  const r = await p.request().query(query);
  return r.recordset;
}

async function safeQuery(query, timeoutMs) {
  if (!sql || sqlFailed) return null;
  try {
    return await Promise.race([
      runQuery(query),
      new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('timeout')); }, timeoutMs); })
    ]);
  } catch (e) { return null; }
}

let dwhPool = null;
async function getDWHPool() {
  if (!sql || dwhFailed) throw new Error('SQL not available');
  if (dwhPool && dwhPool.connected) return dwhPool;
  try {
    dwhPool = await new sql.ConnectionPool({
      server: '203.202.241.211', port: 1433, database: 'DWH',
      user: 'mcp_user', password: 'iAOS@35o997',
      options: { encrypt: false, trustServerCertificate: true },
      connectionTimeout: 15000, requestTimeout: 30000,
      pool: { max: 5, min: 1, idleTimeoutMillis: 30000 }
    }).connect();
    console.log('DWH connected');
    return dwhPool;
  } catch (e) { console.log('DWH SQL failed:', e.message); dwhFailed = true; throw e; }
}

async function runDWHQuery(query) {
  if (!sql || dwhFailed) throw new Error('SQL not available');
  const p = await getDWHPool();
  const r = await p.request().query(query);
  return r.recordset;
}

async function safeDWHQuery(query, timeoutMs) {
  if (!sql || dwhFailed) return null;
  try {
    return await Promise.race([
      runDWHQuery(query),
      new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('timeout')); }, timeoutMs); })
    ]);
  } catch (e) { return null; }
}

// Check if DWH is available
function dwhAvailable() { return !!(sql && !dwhFailed); }

// ============ JSON STORE ============
function readJSON(fn) {
  var fp = path.join(DATA_DIR, fn + '.json');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) { return []; }
}
function writeJSON(fn, data) {
  fs.writeFileSync(path.join(DATA_DIR, fn + '.json'), JSON.stringify(data, null, 2));
}

function nextId(prefix) {
  var cf = path.join(DATA_DIR, '_counters.json');
  var c = {};
  if (fs.existsSync(cf)) { try { c = JSON.parse(fs.readFileSync(cf, 'utf-8')); } catch (e) {} }
  if (!c[prefix]) c[prefix] = 0;
  c[prefix]++;
  fs.writeFileSync(cf, JSON.stringify(c));
  return prefix + '-' + String(c[prefix]).padStart(5, '0');
}

// ============ AUTH HELPERS ============
function hashPassword(pw) {
  var s = crypto.randomBytes(16).toString('hex');
  var h = crypto.scryptSync(pw, s, KEY_LEN).toString('hex');
  return s + ':' + h;
}
function verifyPassword(pw, st) {
  var parts = st.split(':');
  return crypto.scryptSync(pw, parts[0], KEY_LEN).toString('hex') === parts[1];
}

var sessions = new Map();
function createSession(un, role) {
  var t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, { username: un, role: role, createdAt: Date.now() });
  return t;
}
function validateSession(t) {
  var s = sessions.get(t);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_EXPIRY) { sessions.delete(t); return null; }
  return s;
}

var rateLimits = new Map();
function checkRateLimit(ip, limit, windowMs) {
  var now = Date.now();
  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  var entries = rateLimits.get(ip).filter(function (t) { return now - t < windowMs; });
  entries.push(now);
  rateLimits.set(ip, entries);
  return entries.length <= limit;
}

setInterval(function () {
  var now = Date.now();
  rateLimits.forEach(function (entries, ip) {
    var filtered = entries.filter(function (t) { return now - t < 60000; });
    if (filtered.length === 0) rateLimits.delete(ip);
    else rateLimits.set(ip, filtered);
  });
  sessions.forEach(function (s, t) {
    if (now - s.createdAt > SESSION_EXPIRY) sessions.delete(t);
  });
}, 60000);

// ============ MIDDLEWARE ============
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(function (req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com");
  next();
});

function authRequired(req, res, next) {
  var a = req.headers.authorization;
  if (!a || !a.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  var s = validateSession(a.slice(7));
  if (!s) return res.status(401).json({ error: 'Session expired' });
  req.session = s;
  next();
}

function roleRequired() {
  var roles = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

function sanitizeAccounts(accs) { return accs.map(function (a) { var r = Object.assign({}, a); delete r.password; return r; }); }
function sanitizeUser(u) { var r = Object.assign({}, u); delete r.password; return r; }

var DATA_FILES = ['customers', 'leads', 'opportunities', 'orders', 'complaints', 'visits', 'accounts', 'employees'];

function wipeDataFiles() { DATA_FILES.forEach(function (f) { writeJSON(f, []); }); }

// ============ AUTH ENDPOINTS ============
app.post('/api/login', function (req, res) {
  var ip = req.ip;
  if (!checkRateLimit(ip, 10, 60000)) return res.status(429).json({ error: 'Too many attempts.' });
  var username = req.body.username;
  var password = req.body.password;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  var accs = readJSON('accounts');
  var user = accs.find(function (a) { return a.username === username; });
  if (!user || !verifyPassword(password, user.password)) {
    console.log('[AUDIT] LOGIN_FAIL: ' + username);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  var token = createSession(user.username, user.role);
  console.log('[AUDIT] LOGIN_OK: ' + username);
  res.json({ token: token, user: sanitizeUser(user) });
});

app.post('/api/logout', authRequired, function (req, res) {
  sessions.delete(req.headers.authorization.slice(7));
  res.json({ success: true });
});

app.get('/api/session', authRequired, function (req, res) {
  var accs = readJSON('accounts');
  var user = accs.find(function (a) { return a.username === req.session.username; });
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/change-password', authRequired, function (req, res) {
  var currentPassword = req.body.currentPassword;
  var newPassword = req.body.newPassword;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  var accs = readJSON('accounts');
  var idx = accs.findIndex(function (a) { return a.username === req.session.username; });
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(currentPassword, accs[idx].password)) return res.status(400).json({ error: 'Current password incorrect' });
  accs[idx].password = hashPassword(newPassword);
  writeJSON('accounts', accs);
  console.log('[AUDIT] PASSWORD_CHANGE: ' + req.session.username);
  res.json({ success: true });
});

app.post('/api/google-login', function (req, res) {
  var email = req.body.email;
  if (!email) return res.status(400).json({ error: 'Email required' });
  var accs = readJSON('accounts');
  var user = accs.find(function (a) { return (a.username && a.username.toLowerCase().includes(email.toLowerCase())) || (a.email && a.email.toLowerCase() === email.toLowerCase()); });
  if (!user) return res.status(401).json({ error: 'Account not found for this email' });
  var token = createSession(user.username, user.role);
  console.log('[AUDIT] GOOGLE_LOGIN: ' + user.username);
  res.json({ token: token, user: sanitizeUser(user) });
});

// ============ DASHBOARD KPI (cached for speed) ============
var dashboardCache = null;
var dashboardCacheTime = 0;
var DASHBOARD_CACHE_MS = 15000;

async function computeDashboardData() {
  var customers = readJSON('customers');
  var leads = readJSON('leads');
  var opportunities = readJSON('opportunities');
  var orders = readJSON('orders');
  var complaints = readJSON('complaints');
  var visits = readJSON('visits');
  var targets = readJSON('targets');
  var accounts = readJSON('accounts');

  var now = new Date();
  var thisMonth = now.getMonth();
  var thisYear = now.getFullYear();
  var monthKey = thisYear + '-' + String(thisMonth + 1).padStart(2, '0');

  var newThisMonth = customers.filter(function (c) {
    var d = new Date(c.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  var pipelineValue = opportunities.filter(function (o) { return o.stage !== 'Closed Won' && o.stage !== 'Closed Lost'; }).reduce(function (s, o) { return s + (o.value || 0); }, 0);
  var pendingOrders = orders.filter(function (o) { return o.status === 'pending' || o.status === 'processing'; }).length;
  var totalSales = orders.filter(function (o) { return o.status === 'delivered'; }).reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var openLeads = leads.filter(function (l) { return l.status !== 'lost' && l.status !== 'converted'; }).length;
  var openComplaints = complaints.filter(function (c) { return c.status === 'open'; }).length;

  var realCustomerCount = customers.length;
  var realOrderCount = orders.length;
  var realPendingOrders = pendingOrders;
  var realTotalSales = totalSales;
  var realPipelineValue = pipelineValue;
  var realOpenLeads = openLeads;

  if (sql && !dwhFailed && !isRender) {
    var cRes = await safeDWHQuery('SELECT COUNT(*) as cnt FROM prt.tblBusinessPartnerArc WHERE intBusinessUnitId=' + BU_ID + " AND isActive=1 AND strPartnerSalesType='Customer'", 500);
    if (cRes && cRes[0]) realCustomerCount = cRes[0].cnt;
    var oRes = await safeDWHQuery('SELECT COUNT(*) as total_orders, SUM(numTotalOrderValue) as total_sales, SUM(CASE WHEN isCompleted=0 THEN 1 ELSE 0 END) as pending FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=' + BU_ID, 500);
    if (oRes && oRes[0]) { realOrderCount = oRes[0].total_orders; realTotalSales = oRes[0].total_sales || 0; realPendingOrders = oRes[0].pending || 0; }
    realOpenLeads = realPendingOrders;
    var pRes = await safeDWHQuery('SELECT SUM(numTotalOrderValue) as total FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=' + BU_ID + ' AND isCompleted=0 AND isApproved=1 AND isRejected=0', 500);
    if (pRes && pRes[0]) realPipelineValue = pRes[0].total || 0;
  }

  // Pull real sales performance from Google Sheets
  var salesPerf = await getSalesPerformance();
  var designationOrder = { 'Chief Business Officer': 1, 'Senior Manager': 2, 'Deputy Manager': 3, 'Assistant Manager': 4, 'Senior Officer': 5, 'Sales Officer': 6 };

  var spPerformance = (salesPerf.periods || []).map(function (s) {
    return {
      name: s.name,
      username: s.name,
      role: s.designation,
      year: s.year,
      month: s.month,
      territory: s.districts ? s.districts[0] : 'Nobayon Traders Ltd.',
      customers: s.orders,
      visits: Math.round(s.qty * 100) / 100,
      targetSales: 0,
      achievedSales: s.salesValue,
      profit: s.profit,
      costValue: s.costValue,
      pct: null,
      aiSuggestion: (s.profit >= 0 ? 'Profit: +' : 'Loss: ') + (s.profit / 10000000).toFixed(2) + ' Cr'
    };
  }).sort(function (a, b) {
    return (designationOrder[a.role] || 99) - (designationOrder[b.role] || 99);
  });

  var availableYears = salesPerf.years || [];
  var availableMonths = salesPerf.months || [];

  if (spPerformance.length === 0) {
    var ntlTeam = [
      { name: 'Kazi Sibbir Ahammad', role: 'Chief Business Officer', territory: 'Nobayon Traders Ltd.' },
      { name: 'Shek Jasim Uddin', role: 'Senior Manager', territory: 'Trading Sales' },
      { name: 'MD Eynul  Hoque', role: 'Deputy Manager', territory: 'Operations' },
      { name: 'Md Shoib Reza Rajib', role: 'Assistant Manager', territory: 'Operations' }
    ];
    spPerformance = ntlTeam.map(function (sp) {
      return { name: sp.name, username: sp.name, role: sp.role, territory: sp.territory, year: '', month: '', customers: 0, visits: 0, targetSales: 0, achievedSales: 0, profit: 0, pct: null, aiSuggestion: 'No data' };
    });
  }

  var financial = null;
  if (sql && !sqlFailed && !isRender) {
    try {
      var fRes = await safeQuery('SELECT SUM(CASE WHEN numAmount < 0 THEN ABS(numAmount) ELSE 0 END) as totalRevenue, SUM(CASE WHEN strFSComponentName = \'Cost Of Goods Sold\' THEN numAmount ELSE 0 END) as cogs, SUM(numAmount) as netIncome, COUNT(*) as totalTx FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId = ' + BU_ID, 500);
      if (fRes && fRes[0]) financial = fRes[0];
    } catch (e) {}
  }

  return {
    kpi: {
      totalCustomers: realCustomerCount,
      newThisMonth: newThisMonth,
      openLeads: realOpenLeads,
      pipelineValue: realPipelineValue,
      pendingOrders: realPendingOrders,
      totalOrders: realOrderCount,
      totalSales: realTotalSales,
      openComplaints: openComplaints,
      totalVisits: visits.length
    },
    spPerformance: spPerformance,
    availableYears: availableYears,
    availableMonths: availableMonths,
    financial: financial || null,
    buInfo: { code: 'NTL', id: 211, name: 'Nobayon Traders Ltd.', group: 'Trading', subGroup: 'Non Food', taxRate: 25 }
  };
}

app.get('/api/dashboard/stats', authRequired, async function (req, res) {
  try {
    var now = Date.now();
    if (dashboardCache && (now - dashboardCacheTime) < DASHBOARD_CACHE_MS) {
      return res.json(dashboardCache);
    }
    dashboardCache = await computeDashboardData();
    dashboardCacheTime = now;
    res.json(dashboardCache);
  } catch (e) {
    try { dashboardCache = await computeDashboardData(); dashboardCacheTime = Date.now(); return res.json(dashboardCache); } catch (e2) {}
    res.status(500).json({ error: e.message });
  }
});

// ============ DWH ENDPOINTS (SQL only) ============
if (sql) {
  app.get('/api/customers/dwh', authRequired, async function (req, res) {
    if (!dwhAvailable()) return res.status(503).json({ error: 'DWH not available' });
    try {
      var raw = await runDWHQuery("SELECT strBusinessPartnerName as name, strContactNumber as phone, strEmail as email, strBusinessPartnerAddress as address, strPartnerSalesType as partner_type, strDistrictName as district, isActive, strBIN as bin, strBusinessPartnerCode as code, dteLastActionDateTime as last_active FROM prt.tblBusinessPartnerArc WHERE intBusinessUnitId=" + BU_ID + " AND isActive=1 AND strPartnerSalesType='Customer' ORDER BY strBusinessPartnerName");
      var mapped = raw.map(function (r, i) {
        return {
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
        };
      });
      res.json(mapped);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/leads/dwh', authRequired, async function (req, res) {
    if (!dwhAvailable()) return res.status(503).json({ error: 'DWH not available' });
    try {
      var raw = await runDWHQuery("SELECT h.strSalesOrderCode, h.dteSalesOrderDate, h.strSoldToPartnerName as customer, h.strSoldToPartnerAddress, h.numTotalOrderValue as value, h.isCompleted, h.isApproved, h.isRejected, h.strPaymentTermsName, h.strSalesOfficeName, h.strSalesOrganizationName, p.strContactNumber as phone, p.strEmail as email, p.strDistrictName FROM oms.tblSalesOrderHeaderArc h LEFT JOIN prt.tblBusinessPartnerArc p ON h.strSoldToPartnerName = p.strBusinessPartnerName AND p.intBusinessUnitId=h.intBusinessUnitId WHERE h.intBusinessUnitId=" + BU_ID + " AND h.isCompleted=0 ORDER BY h.dteSalesOrderDate DESC");
      var mapped = raw.map(function (r, i) {
        return {
          id: 'L-' + String(i + 1).padStart(4, '0'),
          name: r.customer || 'Unknown',
          phone: r.phone || '',
          email: r.email || '',
          source: r.strDistrictName || '',
          status: r.isRejected ? 'lost' : (r.isApproved ? 'qualified' : 'new'),
          salesperson: r.strSalesOfficeName || '',
          supervisor: 'Kazi Sibbir Ahammad (CBO)',
          notes: (r.strPaymentTermsName || 'N/A') + ' | ' + r.strSalesOrderCode,
          value: r.value || 0
        };
      });
      // Merge prospect leads from Google Sheets (skip existing customers)
      try {
        var prospects = await fetchProspectLeads();
        var existingLeadNames = new Set(mapped.map(function(l){ return l.name.toLowerCase(); }));
        prospects.forEach(function(p){
          if (!existingLeadNames.has(p.name.toLowerCase())) mapped.push(p);
        });
      } catch (e) {}
      res.json(mapped);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/opportunities/dwh', authRequired, async function (req, res) {
    if (!dwhAvailable()) return res.status(503).json({ error: 'DWH not available' });
    try {
      var raw = await runDWHQuery("SELECT TOP 200 strSalesOrderCode, dteSalesOrderDate, strSoldToPartnerName as customer, strSoldToPartnerAddress, numTotalOrderValue as value, isCompleted, isApproved, isRejected, strPaymentTermsName, strSalesOfficeName, dteDueShippingDate FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=" + BU_ID + " AND (isCompleted=0 OR isRejected=1 OR numTotalOrderValue > 5000000) ORDER BY numTotalOrderValue DESC");
      var mapped = raw.map(function (r, i) {
        return {
          id: 'OPP-' + String(i + 1).padStart(4, '0'),
          name: r.customer + ' - ' + r.strSalesOrderCode,
          customer: r.customer || 'Unknown',
          salesperson: r.strSalesOfficeName || '',
          stage: r.isCompleted ? 'Closed Won' : (r.isRejected ? 'Closed Lost' : 'Negotiation'),
          value: r.value || 0,
          probability: r.isCompleted ? 100 : (r.isApproved ? 70 : 30),
          expected_close: r.dteDueShippingDate ? new Date(r.dteDueShippingDate).toISOString().slice(0, 10) : ''
        };
      });
      res.json(mapped);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/orders/dwh', authRequired, async function (req, res) {
    if (!dwhAvailable()) return res.status(503).json({ error: 'DWH not available' });
    try {
      var soMap = await getSoSalesmanMap();
      var raw = await runDWHQuery("SELECT TOP 500 h.strSalesOrderCode as order_code, h.dteSalesOrderDate as order_date, h.strSoldToPartnerName as customer, h.strSoldToPartnerAddress as address, h.numTotalOrderValue as total, h.numNetOrderValue as net_value, h.isCompleted, h.isApproved, h.strPaymentTermsName as payment_terms, h.strSalesOfficeName as sales_office, h.strSalesOrganizationName as sales_org, h.strShippointName as ship_point, h.dteDueShippingDate as due_date, r.strItemName as product, r.numOrderQuantity as quantity, r.numItemPrice as unit_price, r.strUOM as uom FROM oms.tblSalesOrderHeaderArc h LEFT JOIN oms.tblSalesOrderRowArc r ON h.intSalesOrderId = r.intSalesOrderId AND r.intSequenceNo = 1 WHERE h.intBusinessUnitId = " + BU_ID + " ORDER BY h.dteSalesOrderDate DESC");
      var mapped = raw.map(function (r, i) {
        var soNum = (r.order_code || '').trim();
        var salesperson = soMap[soNum] || r.sales_office || '';
        return {
          id: 'SO-' + String(i + 1).padStart(5, '0'),
          customer: r.customer || 'Unknown',
          salesperson: salesperson,
          product: r.product || '',
          quantity: r.quantity || 0,
          unit_price: r.unit_price || 0,
          total: r.total || r.net_value || 0,
          status: r.isCompleted ? 'delivered' : (r.isApproved ? 'processing' : 'pending'),
          order_date: r.order_date ? new Date(r.order_date).toISOString().slice(0, 10) : '',
          delivery_date: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '',
          payment_terms: r.payment_terms || '',
          ship_point: r.ship_point || '',
          uom: r.uom || ''
        };
      });
      res.json(mapped);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/complaints/dwh', authRequired, async function (req, res) {
    if (!dwhAvailable()) return res.status(503).json({ error: 'DWH not available' });
    try {
      var raw = await runDWHQuery("SELECT TOP 200 intSalesReturnId, strSalesOrderNo, strDeliveryChallan, strBusinessPartnerName as customer, strPlantName, strWarehouseName, dteReturnDateTime, numTotalReturnQty, strReassons as reason, isActive, isClosed, strAttachment FROM sms.tblSalesReturnHeaderArc WHERE intBusinessUnitId=" + BU_ID + " ORDER BY dteReturnDateTime DESC");
      var mapped = raw.map(function (r) {
        return {
          id: 'CMP-' + String(r.intSalesReturnId).padStart(4, '0'),
          customer: r.customer || 'Unknown',
          subject: 'Return: ' + (r.strSalesOrderNo || r.strDeliveryChallan || 'N/A'),
          description: r.reason || 'Sales return from ' + r.strPlantName + ', Qty: ' + (r.numTotalReturnQty || 0),
          priority: (r.numTotalReturnQty > 50) ? 'high' : (r.numTotalReturnQty > 10 ? 'medium' : 'low'),
          status: r.isClosed ? 'resolved' : (r.isActive ? 'open' : 'in_progress'),
          assigned_to: r.strWarehouseName || r.strPlantName || 'Trading Sales'
        };
      });
      res.json(mapped);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/employees/dwh', authRequired, async function (req, res) {
    if (!dwhAvailable()) return res.status(503).json({ error: 'DWH not available' });
    try {
      var raw = await runDWHQuery("SELECT e.strEmployeeName as name, d.strDesignation as designation, e.strEmployeeCode as code, e.isActive, sup.strEmployeeName as supervisor, supd.strDesignation as supervisor_role, lm.strEmployeeName as line_manager, lmd.strDesignation as lm_role FROM saas.empEmployeeBasicInfoArc e JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc sup ON e.intSupervisorId = sup.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc supd ON sup.intDesignationId = supd.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc lm ON e.intLineManagerId = lm.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc lmd ON lm.intDesignationId = lmd.intDesignationId WHERE e.intBusinessUnitId=" + BU_ID + " AND e.isActive=1 ORDER BY sup.strEmployeeName, e.strEmployeeName");
      res.json(raw);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

// ============ FINANCIAL ENDPOINTS ============
app.get('/api/financial/summary', authRequired, async function (req, res) {
  try {
    var d = await runQuery("SELECT SUM(CASE WHEN numAmount<0 THEN ABS(numAmount) ELSE 0 END) as totalRevenue, SUM(CASE WHEN strFSComponentName='Cost Of Goods Sold' THEN numAmount ELSE 0 END) as cogs, SUM(CASE WHEN strFSComponentName IN ('Manufacturing Overhead/Cost of Service Provided','Logistics & Distribution Expenses','Selling Expenses','Administrative Expenses','Marketing Expenses','Depreciation Expenses') THEN numAmount ELSE 0 END) as opex, SUM(CASE WHEN strFSComponentName='Financial Expenses' THEN numAmount ELSE 0 END) as financialExp, SUM(CASE WHEN strFSComponentName='Provission For Income Tax' THEN numAmount ELSE 0 END) as tax, SUM(numAmount) as netIncome, COUNT(*) as totalTx, COUNT(DISTINCT strSubGLName) as glAccounts, COUNT(DISTINCT strProfitCenterName) as profitCenters FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=" + BU_ID);
    res.json(d[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/fs-components', authRequired, async function (req, res) {
  try {
    var d = await runQuery("SELECT strFSComponentName as name, strType as type, COUNT(*) as txCount, SUM(numAmount) as totalAmount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=" + BU_ID + " GROUP BY strFSComponentName, strType ORDER BY totalAmount ASC");
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/monthly', authRequired, async function (req, res) {
  try {
    var d = await runQuery("SELECT FORMAT(dteTransactionDate,'yyyy-MM') as month, SUM(CASE WHEN numAmount<0 THEN ABS(numAmount) ELSE 0 END) as revenue, SUM(CASE WHEN strFSComponentName='Cost Of Goods Sold' THEN numAmount ELSE 0 END) as cogs, SUM(CASE WHEN numAmount>0 AND strFSComponentName!='Cost Of Goods Sold' THEN numAmount ELSE 0 END) as expenses, SUM(numAmount) as netIncome, COUNT(*) as txCount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=" + BU_ID + " GROUP BY FORMAT(dteTransactionDate,'yyyy-MM') ORDER BY month");
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/top-gl', authRequired, async function (req, res) {
  try {
    var d = await runQuery("SELECT TOP 30 strSubGLName as name, strGeneralLedgerName as glName, strFSComponentName as component, COUNT(*) as txCount, SUM(numAmount) as totalAmount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=" + BU_ID + " GROUP BY strSubGLName, strGeneralLedgerName, strFSComponentName ORDER BY ABS(SUM(numAmount)) DESC");
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/financial/transactions', authRequired, async function (req, res) {
  try {
    var lim = parseInt(req.query.limit) || 100;
    var d = await runQuery("SELECT TOP " + lim + " dteTransactionDate as date, strFSComponentName as component, strGeneralLedgerName as glName, strSubGLName as subGL, strProfitCenterName as profitCenter, numAmount as amount FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId=" + BU_ID + " ORDER BY dteTransactionDate DESC");
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ CRUD ROUTES ============
function registerCrud(entityName, routePath) {
  var prefixMap = {
    customers: 'CUS', leads: 'LEAD', opportunities: 'OPP',
    orders: 'ORD', complaints: 'CMP', visits: 'VIS', accounts: 'ACC'
  };
  var prefix = prefixMap[entityName] || 'REC';

  app.get('/api/' + routePath, authRequired, function (req, res) {
    var data = readJSON(entityName);
    if (entityName === 'accounts') data = sanitizeAccounts(data);
    res.json(data);
  });

  app.post('/api/' + routePath, authRequired, function (req, res) {
    var data = readJSON(entityName);
    var item = Object.assign({ id: nextId(prefix) }, req.body, { created_at: new Date().toISOString() });
    data.push(item);
    writeJSON(entityName, data);
    console.log('[AUDIT] CREATE ' + entityName + ': ' + item.id + ' by ' + req.session.username);
    res.status(201).json(item);
  });

  app.put('/api/' + routePath + '/:id', authRequired, function (req, res) {
    var data = readJSON(entityName);
    var idx = data.findIndex(function (d) { return d.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data[idx] = Object.assign({}, data[idx], req.body, { updated_at: new Date().toISOString() });
    writeJSON(entityName, data);
    console.log('[AUDIT] UPDATE ' + entityName + ': ' + req.params.id + ' by ' + req.session.username);
    res.json(data[idx]);
  });

  app.delete('/api/' + routePath + '/:id', authRequired, function (req, res) {
    var data = readJSON(entityName);
    var idx = data.findIndex(function (d) { return d.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.splice(idx, 1);
    writeJSON(entityName, data);
    console.log('[AUDIT] DELETE ' + entityName + ': ' + req.params.id + ' by ' + req.session.username);
    res.json({ success: true });
  });
}

registerCrud('customers', 'customers');
registerCrud('leads', 'leads');
registerCrud('opportunities', 'opportunities');
registerCrud('orders', 'orders');
registerCrud('complaints', 'complaints');
registerCrud('visits', 'visits');
registerCrud('employees', 'employees');

// ============ ACCOUNTS CRUD (with role checks) ============
app.get('/api/accounts', authRequired, function (req, res) {
  res.json(sanitizeAccounts(readJSON('accounts')));
});

app.post('/api/accounts', authRequired, roleRequired('super_admin', 'admin'), function (req, res) {
  var accs = readJSON('accounts');
  var username = req.body.username;
  var password = req.body.password;
  var role = req.body.role;
  var name = req.body.name;
  var territory = req.body.territory;
  var supervisor = req.body.supervisor;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (accs.find(function (a) { return a.username === username; })) return res.status(400).json({ error: 'Username exists' });
  var nu = { id: nextId('ACC'), username: username, password: hashPassword(password), name: name || username, role: role || 'so', territory: territory || '', supervisor: supervisor || '', created_at: new Date().toISOString() };
  accs.push(nu);
  writeJSON('accounts', accs);
  res.status(201).json(sanitizeUser(nu));
});

app.put('/api/accounts/:username', authRequired, function (req, res) {
  var accs = readJSON('accounts');
  var idx = accs.findIndex(function (a) { return a.username === req.params.username; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  var reqRole = req.session.role;
  if (reqRole === 'super_admin' || reqRole === 'admin') {
    var updates = Object.assign({}, req.body);
    delete updates.password;
    accs[idx] = Object.assign({}, accs[idx], updates);
    if (req.body.password) accs[idx].password = hashPassword(req.body.password);
  } else if (reqRole === 'sales_head') {
    var requester = accs.find(function (a) { return a.username === req.session.username; });
    if (accs[idx].supervisor !== requester.username && accs[idx].supervisor !== '') {
      return res.status(403).json({ error: 'Can only manage your own team' });
    }
    if (req.body.supervisor !== undefined) accs[idx].supervisor = req.body.supervisor;
    if (req.body.territory !== undefined) accs[idx].territory = req.body.territory;
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  writeJSON('accounts', accs);
  res.json(sanitizeUser(accs[idx]));
});

app.delete('/api/accounts/:username', authRequired, roleRequired('super_admin', 'admin'), function (req, res) {
  var accs = readJSON('accounts');
  var idx = accs.findIndex(function (a) { return a.username === req.params.username; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (accs[idx].username === req.session.username) return res.status(400).json({ error: 'Cannot delete yourself' });
  accs.splice(idx, 1);
  writeJSON('accounts', accs);
  res.json({ success: true });
});

// ============ TARGETS CRUD ============
app.get('/api/targets', authRequired, function (req, res) { res.json(readJSON('targets')); });

app.post('/api/targets', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), function (req, res) {
  var t = readJSON('targets');
  var nt = Object.assign({ id: nextId('TGT') }, req.body, { created_at: new Date().toISOString() });
  t.push(nt);
  writeJSON('targets', t);
  res.status(201).json(nt);
});

app.put('/api/targets/:id', authRequired, roleRequired('super_admin', 'admin', 'sales_head'), function (req, res) {
  var t = readJSON('targets');
  var i = t.findIndex(function (x) { return x.id === req.params.id; });
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  t[i] = Object.assign({}, t[i], req.body);
  writeJSON('targets', t);
  res.json(t[i]);
});

app.delete('/api/targets/:id', authRequired, roleRequired('super_admin', 'admin'), function (req, res) {
  var t = readJSON('targets');
  t = t.filter(function (x) { return x.id !== req.params.id; });
  writeJSON('targets', t);
  res.json({ success: true });
});

// ============ RESET ============
app.post('/api/reset', authRequired, roleRequired('super_admin', 'admin'), function (req, res) {
  wipeDataFiles();
  seedAccounts();
  seedDemoData();
  writeJSON('targets', [
    { salesperson: 'Sohag Hossain', month: '2026-08', targetSales: 800000, targetVisits: 20, targetNewCustomers: 5 },
    { salesperson: 'Sakib Hasan', month: '2026-08', targetSales: 600000, targetVisits: 18, targetNewCustomers: 4 },
    { salesperson: 'Rafiq Islam', month: '2026-08', targetSales: 500000, targetVisits: 15, targetNewCustomers: 3 },
    { salesperson: 'Nisha Akter', month: '2026-08', targetSales: 400000, targetVisits: 12, targetNewCustomers: 3 }
  ]);
  dashboardCache = null;
  res.json({ success: true });
});

// ============ SEED DATA ============
function seedAccounts() {
  var accs = [
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
  writeJSON('accounts', accs);
}

function seedDemoData() {
  var now = Date.now();
  var day = 86400000;

  writeJSON('customers', [
    { id: 'CUS-00001', name: 'BuildMart Ltd.', phone: '01710000001', email: 'info@buildmart.com', address: '123 Gulshan Ave, Dhaka', salesperson: 'Sohag Hossain', status: 'active', source: 'Referral', created_at: new Date(now - 30 * day).toISOString() },
    { id: 'CUS-00002', name: 'SteelCraft Industries', phone: '01710000002', email: 'contact@steelcraft.com', address: '45 Tejgaon I/A, Dhaka', salesperson: 'Sohag Hossain', status: 'active', source: 'Walk-in', created_at: new Date(now - 25 * day).toISOString() },
    { id: 'CUS-00003', name: 'GreenBuild Developers', phone: '01710000003', email: 'sales@greenbuild.com', address: '78 Banani, Dhaka', salesperson: 'Sakib Hasan', status: 'active', source: 'Website', created_at: new Date(now - 20 * day).toISOString() },
    { id: 'CUS-00004', name: 'Metro Construction', phone: '01710000004', email: 'info@metrocon.com', address: '12 Mirpur Rd, Dhaka', salesperson: 'Sakib Hasan', status: 'active', source: 'Trade Show', created_at: new Date(now - 15 * day).toISOString() },
    { id: 'CUS-00005', name: 'Prime Builders', phone: '01710000005', email: 'hello@primebuilders.com', address: '56 Uttara, Dhaka', salesperson: 'Sakib Hasan', status: 'inactive', source: 'Cold Call', created_at: new Date(now - 10 * day).toISOString() },
    { id: 'CUS-00006', name: 'Akij Ceramics Dealer', phone: '01710000006', email: 'dealer@akij.com', address: '34 Motijheel, Dhaka', salesperson: 'Rafiq Islam', status: 'active', source: 'Existing', created_at: new Date(now - 8 * day).toISOString() },
    { id: 'CUS-00007', name: 'National Housing', phone: '01710000007', email: 'info@nationalhousing.com', address: '90 Dhanmondi, Dhaka', salesperson: 'Rafiq Islam', status: 'active', source: 'Referral', created_at: new Date(now - 5 * day).toISOString() },
    { id: 'CUS-00008', name: 'City Developers Ltd.', phone: '01710000008', email: 'admin@citydev.com', address: '23 Bashundhara, Dhaka', salesperson: 'Nisha Akter', status: 'lead', source: 'Website', created_at: new Date(now - 3 * day).toISOString() },
    { id: 'CUS-00009', name: 'Sunrise Properties', phone: '01710000009', email: 'care@sunriseprop.com', address: '67 Baridhara, Dhaka', salesperson: 'Nisha Akter', status: 'active', source: 'Social Media', created_at: new Date(now - 2 * day).toISOString() },
    { id: 'CUS-00010', name: 'Mega Infra Ltd.', phone: '01710000010', email: 'info@megainfra.com', address: '88 Gulshan-2, Dhaka', salesperson: 'Sohag Hossain', status: 'lead', source: 'Email Campaign', created_at: new Date().toISOString() }
  ]);

  writeJSON('leads', [
    { id: 'LEAD-00001', name: 'Alam Group', phone: '01720000001', email: 'alam@group.com', source: 'Website', status: 'new', salesperson: 'Sohag Hossain', notes: 'Interested in bulk cement', value: 500000, created_at: new Date(now - 5 * day).toISOString() },
    { id: 'LEAD-00002', name: 'Bismillah Traders', phone: '01720000002', email: 'bismillah@traders.com', source: 'Referral', status: 'contacted', salesperson: 'Sakib Hasan', notes: 'Needs steel rods quote', value: 300000, created_at: new Date(now - 3 * day).toISOString() },
    { id: 'LEAD-00003', name: 'Chowdhury Enterprise', phone: '01720000003', email: 'chowdhury@ent.com', source: 'Walk-in', status: 'qualified', salesperson: 'Rafiq Islam', notes: 'Ready to sign', value: 800000, created_at: new Date(now - 2 * day).toISOString() },
    { id: 'LEAD-00004', name: 'Dhaka Mega Mart', phone: '01720000004', email: 'dmart@dm.com', source: 'Trade Show', status: 'new', salesperson: 'Nisha Akter', notes: 'Cement and tiles', value: 1200000, created_at: new Date(now - 1 * day).toISOString() },
    { id: 'LEAD-00005', name: 'Eastern Suppliers', phone: '01720000005', email: 'eastern@supply.com', source: 'Cold Call', status: 'lost', salesperson: 'Sohag Hossain', notes: 'Went with competitor', value: 200000, created_at: new Date().toISOString() }
  ]);

  writeJSON('opportunities', [
    { id: 'OPP-00001', name: 'BuildMart Cement Supply', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', stage: 'Negotiation', value: 800000, probability: 70, expected_close: '2026-09-15', created_at: new Date(now - 10 * day).toISOString() },
    { id: 'OPP-00002', name: 'SteelCraft Rods Deal', customer: 'SteelCraft Industries', salesperson: 'Sohag Hossain', stage: 'Proposal', value: 1200000, probability: 50, expected_close: '2026-10-01', created_at: new Date(now - 8 * day).toISOString() },
    { id: 'OPP-00003', name: 'GreenBuild Tiles Order', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', stage: 'Qualification', value: 500000, probability: 30, expected_close: '2026-09-30', created_at: new Date(now - 5 * day).toISOString() },
    { id: 'OPP-00004', name: 'Metro Sanitary Ware', customer: 'Metro Construction', salesperson: 'Sakib Hasan', stage: 'Closed Won', value: 350000, probability: 100, expected_close: '2026-08-15', created_at: new Date(now - 12 * day).toISOString() }
  ]);

  writeJSON('orders', [
    { id: 'ORD-00001', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', product: 'Cement OPC 50kg', quantity: 500, unit_price: 420, total: 210000, status: 'delivered', order_date: '2026-08-01', delivery_date: '2026-08-05', created_at: new Date(now - 10 * day).toISOString() },
    { id: 'ORD-00002', customer: 'SteelCraft Industries', salesperson: 'Sohag Hossain', product: 'Steel Rods 60 Grade', quantity: 200, unit_price: 850, total: 170000, status: 'pending', order_date: '2026-08-03', created_at: new Date(now - 8 * day).toISOString() },
    { id: 'ORD-00003', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', product: 'Ceramic Tiles', quantity: 1000, unit_price: 55, total: 55000, status: 'processing', order_date: '2026-08-05', created_at: new Date(now - 6 * day).toISOString() },
    { id: 'ORD-00004', customer: 'Metro Construction', salesperson: 'Sakib Hasan', product: 'Sanitary Ware Set', quantity: 50, unit_price: 1200, total: 60000, status: 'delivered', order_date: '2026-08-07', delivery_date: '2026-08-09', created_at: new Date(now - 4 * day).toISOString() },
    { id: 'ORD-00005', customer: 'Akij Ceramics Dealer', salesperson: 'Rafiq Islam', product: 'Tiles Premium', quantity: 2000, unit_price: 65, total: 130000, status: 'pending', order_date: '2026-08-10', created_at: new Date(now - 1 * day).toISOString() }
  ]);

  writeJSON('complaints', [
    { id: 'CMP-00001', customer: 'Prime Builders', subject: 'Delayed delivery', description: 'Order not delivered on promised date', priority: 'high', status: 'open', assigned_to: 'Contact Center', created_at: new Date(now - 3 * day).toISOString() },
    { id: 'CMP-00002', customer: 'City Developers Ltd.', subject: 'Product quality issue', description: 'Tiles have color variation', priority: 'medium', status: 'in_progress', assigned_to: 'Contact Center', created_at: new Date(now - 2 * day).toISOString() },
    { id: 'CMP-00003', customer: 'Metro Construction', subject: 'Billing discrepancy', description: 'Invoice amount does not match PO', priority: 'low', status: 'resolved', assigned_to: 'Contact Center', created_at: new Date(now - 5 * day).toISOString() }
  ]);

  writeJSON('visits', [
    { id: 'VIS-00001', customer: 'BuildMart Ltd.', salesperson: 'Sohag Hossain', purpose: 'Follow-up', visit_type: 'sales', outcome: 'Positive', visit_date: '2026-08-10', next_visit: '2026-08-17', notes: 'Customer happy with product quality', created_at: new Date(now - 1 * day).toISOString() },
    { id: 'VIS-00002', customer: 'GreenBuild Developers', salesperson: 'Sakib Hasan', purpose: 'New product intro', visit_type: 'sales', outcome: 'Interested', visit_date: '2026-08-09', next_visit: '2026-08-20', notes: 'Requested quotation for tiles', created_at: new Date(now - 2 * day).toISOString() },
    { id: 'VIS-00003', customer: 'Akij Ceramics Dealer', salesperson: 'Rafiq Islam', purpose: 'Order collection', visit_type: 'sales', outcome: 'Completed', visit_date: '2026-08-08', notes: '', created_at: new Date(now - 3 * day).toISOString() },
    { id: 'VIS-00004', customer: 'National Housing', salesperson: 'Rafiq Islam', purpose: 'Site inspection', visit_type: 'quality_control', outcome: 'Positive', visit_date: '2026-08-11', next_visit: '2026-08-25', notes: 'Quality check passed, minor rework needed', created_at: new Date().toISOString() },
    { id: 'VIS-00005', customer: 'Sunrise Properties', salesperson: 'Nisha Akter', purpose: 'Product demo', visit_type: 'sales', outcome: 'Interested', visit_date: '2026-08-11', notes: '', created_at: new Date().toISOString() },
    { id: 'VIS-00006', customer: 'Steel Supplier Ltd.', salesperson: 'Karim Mia', purpose: 'Supplier meeting', visit_type: 'purchase', outcome: 'Positive', visit_date: '2026-08-09', next_visit: '2026-08-16', notes: 'Negotiated 5% discount on bulk steel', created_at: new Date(now - 2 * day).toISOString() },
    { id: 'VIS-00007', customer: 'Cement Corp.', salesperson: 'Karim Mia', purpose: 'Vendor audit', visit_type: 'purchase', outcome: 'Completed', visit_date: '2026-08-07', notes: 'Supplier audit cleared', created_at: new Date(now - 4 * day).toISOString() },
    { id: 'VIS-00008', customer: 'Metro Construction', salesperson: 'Sakib Hasan', purpose: 'Quality inspection', visit_type: 'quality_control', outcome: 'Pending', visit_date: '2026-08-10', notes: 'Samples collected for lab testing', created_at: new Date(now - 1 * day).toISOString() }
  ]);

  writeJSON('employees', [
    { id: 'EMP-00001', name: 'Kazi Sibbir Ahammad', designation: 'Chief Business Officer', code: 'NTL-CBO-001', isActive: true, supervisor: '', line_manager: 'Group CEO', created_at: new Date().toISOString() },
    { id: 'EMP-00002', name: 'Karim Mia', designation: 'Sales Head', code: 'NTL-SH-001', isActive: true, supervisor: 'Kazi Sibbir Ahammad', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date().toISOString() },
    { id: 'EMP-00003', name: 'Sohag Hossain', designation: 'Sales Officer', code: 'NTL-SO-001', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date().toISOString() },
    { id: 'EMP-00004', name: 'Sakib Hasan', designation: 'Sales Officer', code: 'NTL-SO-002', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date().toISOString() },
    { id: 'EMP-00005', name: 'Rafiq Islam', designation: 'Sales Officer', code: 'NTL-SO-003', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date().toISOString() },
    { id: 'EMP-00006', name: 'Nisha Akter', designation: 'Sales Officer', code: 'NTL-SO-004', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date().toISOString() },
    { id: 'EMP-00007', name: 'Contact Center Team', designation: 'Contact Center Agent', code: 'NTL-CC-001', isActive: true, supervisor: 'Rahim Uddin', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date().toISOString() },
    { id: 'EMP-00008', name: 'Sales Excellence Team', designation: 'Sales Excellence Analyst', code: 'NTL-SE-001', isActive: true, supervisor: 'Rahim Uddin', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date().toISOString() },
    { id: 'EMP-00009', name: 'Noor Mohammad', designation: 'Quality Control Officer', code: 'NTL-QC-001', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date().toISOString() },
    { id: 'EMP-00010', name: 'Hasan Mahmud', designation: 'Purchase Officer', code: 'NTL-PO-001', isActive: true, supervisor: 'Karim Mia', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date().toISOString() }
  ]);
}

// ============ INIT ============
(function init() {
  var seedRealData = {};
  try { seedRealData = require('./data/seed-real.json'); } catch (e) {}

  wipeDataFiles();
  seedAccounts();

  if (seedRealData.customers) {
    writeJSON('customers', seedRealData.customers);
  }
  if (seedRealData.orders) {
    writeJSON('orders', seedRealData.orders);
  }
  if (seedRealData.leads) {
    writeJSON('leads', seedRealData.leads);
  }
  if (seedRealData.opportunities) {
    writeJSON('opportunities', seedRealData.opportunities);
  }
  if (seedRealData.complaints) {
    writeJSON('complaints', seedRealData.complaints);
  }
  if (seedRealData.visits) {
    writeJSON('visits', seedRealData.visits);
  }
  if (seedRealData.employees) {
    writeJSON('employees', seedRealData.employees);
  }
  if (seedRealData.accounts) {
    writeJSON('accounts', seedRealData.accounts);
  }

  if (!seedRealData.customers) {
    seedDemoData();
  }

  writeJSON('targets', [
    { salesperson: 'Sohag Hossain', month: '2026-08', targetSales: 800000, targetVisits: 20, targetNewCustomers: 5 },
    { salesperson: 'Sakib Hasan', month: '2026-08', targetSales: 600000, targetVisits: 18, targetNewCustomers: 4 },
    { salesperson: 'Rafiq Islam', month: '2026-08', targetSales: 500000, targetVisits: 15, targetNewCustomers: 3 },
    { salesperson: 'Nisha Akter', month: '2026-08', targetSales: 400000, targetVisits: 12, targetNewCustomers: 3 }
  ]);

  if (readJSON('employees').length === 0) {
    var now = Date.now();
    writeJSON('employees', [
      { id: 'EMP-00001', name: 'Kazi Sibbir Ahammad', designation: 'Chief Business Officer', code: 'NTL-CBO-001', isActive: true, supervisor: '', line_manager: 'Group CEO', created_at: new Date(now).toISOString() },
      { id: 'EMP-00002', name: 'Karim Mia', designation: 'Sales Head', code: 'NTL-SH-001', isActive: true, supervisor: 'Kazi Sibbir Ahammad', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date(now).toISOString() },
      { id: 'EMP-00003', name: 'Sohag Hossain', designation: 'Sales Officer', code: 'NTL-SO-001', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date(now).toISOString() },
      { id: 'EMP-00004', name: 'Sakib Hasan', designation: 'Sales Officer', code: 'NTL-SO-002', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date(now).toISOString() },
      { id: 'EMP-00005', name: 'Rafiq Islam', designation: 'Sales Officer', code: 'NTL-SO-003', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date(now).toISOString() },
      { id: 'EMP-00006', name: 'Nisha Akter', designation: 'Sales Officer', code: 'NTL-SO-004', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date(now).toISOString() },
      { id: 'EMP-00007', name: 'Contact Center Team', designation: 'Contact Center Agent', code: 'NTL-CC-001', isActive: true, supervisor: 'Rahim Uddin', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date(now).toISOString() },
      { id: 'EMP-00008', name: 'Sales Excellence Team', designation: 'Sales Excellence Analyst', code: 'NTL-SE-001', isActive: true, supervisor: 'Rahim Uddin', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date(now).toISOString() },
      { id: 'EMP-00009', name: 'Noor Mohammad', designation: 'Quality Control Officer', code: 'NTL-QC-001', isActive: true, supervisor: 'Karim Mia', line_manager: 'Karim Mia', created_at: new Date(now).toISOString() },
      { id: 'EMP-00010', name: 'Hasan Mahmud', designation: 'Purchase Officer', code: 'NTL-PO-001', isActive: true, supervisor: 'Karim Mia', line_manager: 'Kazi Sibbir Ahammad', created_at: new Date(now).toISOString() }
    ]);
  }

  if (sql && !isRender) {
    setTimeout(async function () {
      try { await getDWHPool(); console.log('DWH warm-up: connected'); } catch (e) { console.log('DWH warm-up failed (non-critical):', e.message); }
    }, 1000);
  }
})();

app.listen(PORT, function () {
  console.log('NTL CRM - Nobayon Traders Ltd. (BU 211) running on http://localhost:' + PORT);
  var exec = require('child_process').exec;
  exec('start http://localhost:' + PORT);
});

