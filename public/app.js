// ==================== STATE ====================
const state = {
  user: null,
  token: null,
  currentTab: 'dashboard',
  navHistory: [],
  customers: [],
  leads: [],
  opportunities: [],
  orders: [],
  complaints: [],
  visits: [],
  accounts: [],
  targets: [],
  dashboardData: null
};

const API = '';

const ROLE_HIERARCHY = {
  super_admin: ['dashboard','customers','leads','opportunities','orders','complaints','visits','team','reports','accounts'],
  admin: ['dashboard','customers','leads','opportunities','orders','complaints','visits','team','reports','accounts'],
  sales_head: ['dashboard','customers','leads','opportunities','orders','visits','team','reports'],
  so: ['dashboard','customers','leads','opportunities','orders','visits'],
  contact_center: ['complaints'],
  sales_excellence: ['reports'],
  management: ['dashboard','reports']
};

const NAV_GROUPS = {
  main: { title: 'Main', items: [{ id: 'dashboard', label: 'Dashboard' }] },
  modules: {
    title: 'Modules',
    items: [
      { id: 'customers', label: 'Customers' },
      { id: 'leads', label: 'Leads' },
      { id: 'opportunities', label: 'Opportunities' },
      { id: 'orders', label: 'Orders' },
      { id: 'complaints', label: 'Complaints' },
      { id: 'visits', label: 'Visits' }
    ]
  },
  operations: {
    title: 'Operations',
    items: [
      { id: 'team', label: 'Team' },
      { id: 'reports', label: 'Reports' },
      { id: 'accounts', label: 'Accounts' }
    ]
  }
};

const NAV_ICONS = {
  dashboard: '\uD83D\uDCCA',
  customers: '\uD83D\uDC65',
  leads: '\uD83C\uDFAF',
  opportunities: '\uD83D\uDCB0',
  orders: '\uD83D\uDED2',
  complaints: '\uD83D\uDEE0\uFE0F',
  visits: '\uD83D\uDCCD',
  team: '\uD83D\uDC65',
  reports: '\uD83D\uDCCA',
  accounts: '\u2699\uFE0F'
};

const KPI_CARD_COLORS = ['navy','cyan','green','amber','red','navy','cyan','green'];

// ==================== API HELPERS ====================
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const apiGet = p => api('GET', p);
const apiPost = (p, b) => api('POST', p, b);
const apiPut = (p, b) => api('PUT', p, b);
const apiDel = p => api('DELETE', p);

// ==================== AUTH ====================
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const data = await apiPost('/api/login', { username, password });
    state.token = data.token;
    state.user = data.user;
    sessionStorage.setItem('crm_token', data.token);
    sessionStorage.setItem('crm_user', JSON.stringify(data.user));
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function logout() {
  try { await apiPost('/api/logout'); } catch {}
  state.token = null;
  state.user = null;
  state.navHistory = [];
  sessionStorage.clear();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = '';
  document.getElementById('login-form').reset();
}

async function restoreSession() {
  const token = sessionStorage.getItem('crm_token');
  if (!token) return false;
  state.token = token;
  try {
    const data = await apiGet('/api/session');
    state.user = data.user;
    return true;
  } catch {
    sessionStorage.clear();
    state.token = null;
    return false;
  }
}

// ==================== NAVIGATION ====================
function navigate(tab, replace) {
  if (!state.user) return;
  const allowed = ROLE_HIERARCHY[state.user.role] || [];
  if (!allowed.includes(tab)) return;

  if (!replace) state.navHistory.push(state.currentTab);
  state.currentTab = tab;
  renderPage();
}

function goBack() {
  if (state.navHistory.length === 0) return;
  state.currentTab = state.navHistory.pop();
  renderPage();
}

function renderPage() {
  const backBtn = document.getElementById('back-btn');
  backBtn.classList.toggle('visible', state.navHistory.length > 0);
  document.getElementById('header-action-btn').style.display = 'none';

  const renderers = {
    dashboard: renderDashboard,
    customers: () => renderEntityView('customers', 'Customers'),
    leads: () => renderEntityView('leads', 'Leads'),
    opportunities: () => renderEntityView('opportunities', 'Opportunities'),
    orders: () => renderEntityView('orders', 'Orders'),
    complaints: () => renderEntityView('complaints', 'Complaints'),
    visits: () => renderEntityView('visits', 'Visits'),
    team: renderTeam,
    reports: renderReports,
    accounts: renderAccounts
  };

  const labels = {
    dashboard: 'Dashboard',
    customers: 'Customers',
    leads: 'Leads',
    opportunities: 'Opportunities',
    orders: 'Orders',
    complaints: 'Complaints',
    visits: 'Visits',
    team: 'Team Management',
    reports: 'Reports',
    accounts: 'User Accounts'
  };

  document.getElementById('page-title').textContent = labels[state.currentTab] || state.currentTab;
  updateSidebar();

  if (renderers[state.currentTab]) renderers[state.currentTab]();
}

// ==================== SIDEBAR ====================
function updateSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const allowed = ROLE_HIERARCHY[state.user.role] || [];
  let html = '';

  Object.values(NAV_GROUPS).forEach(group => {
    const visibleItems = group.items.filter(item => allowed.includes(item.id));
    if (visibleItems.length === 0) return;
    html += `<div class="nav-section"><div class="nav-section-title">${group.title}</div>`;
    visibleItems.forEach(item => {
      const active = state.currentTab === item.id ? ' active' : '';
      html += `<div class="nav-item${active}" onclick="navigate('${item.id}')">
        <span class="nav-icon">${NAV_ICONS[item.id]}</span> ${item.label}
      </div>`;
    });
    html += '</div>';
  });

  nav.innerHTML = html;
}

// ==================== MODAL ====================
function openModal(title, bodyHtml, footerHtml) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="btn-icon" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
  `;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ==================== ENTITY FORM HELPER ====================
function buildEntityForm(entity, fields, existing) {
  return fields.map(f => {
    const val = existing ? (existing[f.name] || '') : '';
    if (f.type === 'select') {
      return `<div class="form-group">
        <label>${f.label}</label>
        <select id="ef-${f.name}">
          ${f.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="form-group">
        <label>${f.label}</label>
        <textarea id="ef-${f.name}">${val}</textarea>
      </div>`;
    }
    return `<div class="form-group">
      <label>${f.label}</label>
      <input type="${f.type || 'text'}" id="ef-${f.name}" value="${val}">
    </div>`;
  }).join('');
}

function getEntityFields(entity) {
  const fieldsMap = {
    customers: [
      { name: 'name', label: 'Name' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'address', label: 'Address' },
      { name: 'salesperson', label: 'Salesperson', type: 'select', options: getSONames() },
      { name: 'status', label: 'Status', type: 'select', options: ['active','inactive','lead'] },
      { name: 'source', label: 'Source', type: 'select', options: ['Referral','Walk-in','Website','Cold Call','Trade Show','Social Media','Email Campaign','Existing'] }
    ],
    leads: [
      { name: 'name', label: 'Name' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'source', label: 'Source', type: 'select', options: ['Website','Referral','Walk-in','Trade Show','Cold Call','Social Media','Email Campaign'] },
      { name: 'status', label: 'Status', type: 'select', options: ['new','contacted','qualified','proposal','lost','converted'] },
      { name: 'salesperson', label: 'Salesperson', type: 'select', options: getSONames() },
      { name: 'value', label: 'Value (BDT)', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ],
    opportunities: [
      { name: 'name', label: 'Opportunity Name' },
      { name: 'customer', label: 'Customer' },
      { name: 'salesperson', label: 'Salesperson', type: 'select', options: getSONames() },
      { name: 'stage', label: 'Stage', type: 'select', options: ['Qualification','Proposal','Negotiation','Closed Won','Closed Lost'] },
      { name: 'value', label: 'Value (BDT)', type: 'number' },
      { name: 'probability', label: 'Probability (%)', type: 'number' },
      { name: 'expected_close', label: 'Expected Close', type: 'date' }
    ],
    orders: [
      { name: 'customer', label: 'Customer' },
      { name: 'salesperson', label: 'Salesperson', type: 'select', options: getSONames() },
      { name: 'product', label: 'Product' },
      { name: 'quantity', label: 'Quantity', type: 'number' },
      { name: 'unit_price', label: 'Unit Price (BDT)', type: 'number' },
      { name: 'total', label: 'Total (BDT)', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', options: ['pending','processing','delivered','cancelled'] },
      { name: 'order_date', label: 'Order Date', type: 'date' },
      { name: 'delivery_date', label: 'Delivery Date', type: 'date' }
    ],
    complaints: [
      { name: 'customer', label: 'Customer' },
      { name: 'subject', label: 'Subject' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low','medium','high','critical'] },
      { name: 'status', label: 'Status', type: 'select', options: ['open','in_progress','resolved','closed'] },
      { name: 'assigned_to', label: 'Assigned To' }
    ],
    visits: [
      { name: 'customer', label: 'Customer' },
      { name: 'salesperson', label: 'Salesperson', type: 'select', options: getSONames() },
      { name: 'purpose', label: 'Purpose', type: 'select', options: ['Follow-up','New product intro','Order collection','Site inspection','Product demo','Relationship building','Complaint resolution'] },
      { name: 'outcome', label: 'Outcome', type: 'select', options: ['Positive','Interested','Completed','Pending','No response'] },
      { name: 'visit_date', label: 'Visit Date', type: 'date' },
      { name: 'next_visit', label: 'Next Visit', type: 'date' }
    ]
  };
  return fieldsMap[entity] || [];
}

function getSONames() {
  return state.accounts
    .filter(a => a.role === 'so' || a.role === 'sales_head')
    .map(a => a.name);
}

function getCustomerNames() {
  return state.customers.map(c => c.name);
}

// ==================== SAVE ENTITY ====================
async function saveEntity(entity, id) {
  const fields = getEntityFields(entity);
  const body = {};
  fields.forEach(f => {
    const el = document.getElementById('ef-' + f.name);
    if (el) body[f.name] = f.type === 'number' ? Number(el.value) || 0 : el.value;
  });
  if (entity === 'orders' && body.quantity && body.unit_price && !body.total) {
    body.total = body.quantity * body.unit_price;
  }
  try {
    if (id) {
      await apiPut(`/api/${entity}/${id}`, body);
    } else {
      await apiPost(`/api/${entity}`, body);
    }
    closeModal();
    await reloadEntity(entity);
    renderPage();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteEntity(entity, id) {
  if (!confirm('Are you sure you want to delete this record?')) return;
  try {
    await apiDel(`/api/${entity}/${id}`);
    closeModal();
    await reloadEntity(entity);
    renderPage();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function reloadEntity(entity) {
  try {
    state[entity] = await apiGet(`/api/${entity}`);
  } catch {}
}

// ==================== ENTITY VIEW ====================
function showEntityForm(entity, existing) {
  const fields = getEntityFields(entity);
  if (entity === 'opportunities' && !existing) {
    const custField = fields.find(f => f.name === 'customer');
    if (custField) custField.options = getCustomerNames();
  }
  if (entity === 'visits' && !existing) {
    const custField = fields.find(f => f.name === 'customer');
    if (custField) custField.options = getCustomerNames();
  }
  if (entity === 'orders' && !existing) {
    const custField = fields.find(f => f.name === 'customer');
    if (custField) custField.options = getCustomerNames();
  }
  if (entity === 'complaints' && !existing) {
    const custField = fields.find(f => f.name === 'customer');
    if (custField) custField.options = getCustomerNames();
  }

  const id = existing ? existing.id : null;
  const title = existing ? `Edit ${entity.slice(0, -1)}` : `New ${entity.slice(0, -1)}`;
  const bodyHtml = buildEntityForm(entity, fields, existing);
  const footerHtml = `
    ${id ? `<button class="btn btn-danger btn-sm" onclick="deleteEntity('${entity}','${id}')">Delete</button>` : ''}
    <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="saveEntity('${entity}','${id || ''}')">Save</button>
  `;
  openModal(title, bodyHtml, footerHtml);
}

async function renderEntityView(entity, title) {
  const content = document.getElementById('content-area');
  const data = state[entity] || [];
  const headerBtn = document.getElementById('header-action-btn');
  headerBtn.style.display = 'inline-flex';
  headerBtn.textContent = '+ Add ' + title.slice(0, -1);
  headerBtn.onclick = () => showEntityForm(entity, null);

  let html = `<div class="table-section">
    <div class="table-section-header">
      <h3>${title} (${data.length})</h3>
      <div class="toolbar">
        <input type="text" class="search-box" placeholder="Search ${title.toLowerCase()}..." oninput="filterTable('${entity}-table', this.value)">
        <button class="btn btn-primary btn-sm" onclick="showEntityForm('${entity}', null)">+ Add New</button>
      </div>
    </div>`;

  if (data.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">&#128203;</div>
      <h4>No ${title.toLowerCase()} found</h4>
      <p>Click "+ Add" to create the first one.</p>
    </div>`;
  } else {
    html += `<div style="overflow-x:auto"><table id="${entity}-table">`;
    const sample = data[0];
    const cols = Object.keys(sample).filter(k => !['created_at','updated_at'].includes(k));
    html += '<thead><tr>' + cols.map(c => `<th>${c.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</th>`).join('') + '<th style="width:80px">Actions</th></tr></thead>';
    html += '<tbody>';
    data.forEach(item => {
      html += '<tr class="clickable" onclick="showEntityForm(\'' + entity + '\',' + JSON.stringify(item).replace(/"/g,'&quot;') + ')">';
      cols.forEach(c => {
        let val = item[c] || '';
        if (c === 'status') {
          const color = val === 'active' || val === 'delivered' || val === 'resolved' || val === 'converted' || val === 'Closed Won' ? 'green' :
                        val === 'inactive' || val === 'lost' || val === 'Closed Lost' || val === 'cancelled' ? 'red' :
                        val === 'new' || val === 'pending' || val === 'open' ? 'cyan' : 'amber';
          val = `<span class="badge badge-${color}">${val}</span>`;
        }
        if (c === 'priority') {
          const color = val === 'critical' || val === 'high' ? 'red' : val === 'medium' ? 'amber' : 'green';
          val = `<span class="badge badge-${color}">${val}</span>`;
        }
        if (c === 'value' || c === 'total' || c === 'unit_price') {
          val = val ? '&#2547; ' + Number(val).toLocaleString() : '-';
        }
        html += `<td>${val}</td>`;
      });
      html += '<td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();showEntityForm(\'' + entity + '\',' + JSON.stringify(item).replace(/"/g,'&quot;') + ')">Edit</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  content.innerHTML = html;
}

function filterTable(tableId, query) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const rows = table.querySelectorAll('tbody tr');
  const q = query.toLowerCase();
  rows.forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ==================== DASHBOARD ====================
async function renderDashboard() {
  const content = document.getElementById('content-area');
  content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-400)">Loading dashboard...</div>';

  try {
    state.dashboardData = await apiGet('/api/dashboard/stats');
  } catch {
    content.innerHTML = '<div class="alert alert-error">Failed to load dashboard</div>';
    return;
  }

  const { kpi, spPerformance } = state.dashboardData;
  const cards = [
    { label: 'Total Customers', value: kpi.totalCustomers, sub: `${kpi.newThisMonth} new this month`, navigate: 'customers', color: 'navy' },
    { label: 'Open Leads', value: kpi.openLeads, sub: 'Active leads', navigate: 'leads', color: 'cyan' },
    { label: 'Pipeline Value', value: '\u09F3 ' + kpi.pipelineValue.toLocaleString(), sub: 'Active opportunities', navigate: 'opportunities', color: 'green' },
    { label: 'Pending Orders', value: kpi.pendingOrders, sub: 'Awaiting processing', navigate: 'orders', color: 'amber' },
    { label: 'Total Sales', value: '\u09F3 ' + kpi.totalSales.toLocaleString(), sub: 'Delivered orders', navigate: 'orders', color: 'navy' },
    { label: 'Open Complaints', value: kpi.openComplaints, sub: 'Awaiting resolution', navigate: 'complaints', color: 'red' },
    { label: 'Total Visits', value: kpi.totalVisits, sub: 'Field visits logged', navigate: 'visits', color: 'cyan' },
    { label: 'New This Month', value: kpi.newThisMonth, sub: `Out of ${kpi.totalCustomers} total`, navigate: 'customers', color: 'green' }
  ];

  let html = `<div class="kpi-grid">`;
  cards.forEach(c => {
    html += `<div class="stat-card ${c.color}" onclick="navigate('${c.navigate}')">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-sub">${c.sub}</div>
    </div>`;
  });
  html += '</div>';

  html += `<div class="table-section">
    <div class="table-section-header">
      <h3>Salesperson Performance</h3>
      <div class="toolbar">
        <span style="font-size:12px;color:var(--gray-400)">August 2026</span>
      </div>
    </div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Name</th><th>Territory</th><th>Customers</th><th>Visits</th>
        <th>Target (\u09F3)</th><th>Achieved (\u09F3)</th><th>%</th><th>AI Suggestion</th>
      </tr></thead>
      <tbody>`;

  spPerformance.forEach(sp => {
    const pctBadge = sp.pct === null ? '<span class="badge badge-gray">N/A</span>' :
      sp.pct >= 100 ? `<span class="badge badge-green">${sp.pct}%</span>` :
      sp.pct >= 70 ? `<span class="badge badge-amber">${sp.pct}%</span>` :
      `<span class="badge badge-red">${sp.pct}%</span>`;

    html += `<tr class="clickable" onclick="document.getElementById('cust-search') ? (document.getElementById('cust-search').value='${sp.name.replace(/'/g,"\\'")}',navigate('customers')) : navigate('customers')">
      <td><strong>${sp.name}</strong><br><span style="font-size:11px;color:var(--gray-400)">${sp.role.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</span></td>
      <td>${sp.territory || '-'}</td>
      <td>${sp.customers}</td>
      <td>${sp.visits}</td>
      <td>\u09F3 ${sp.targetSales.toLocaleString()}</td>
      <td>\u09F3 ${sp.achievedSales.toLocaleString()}</td>
      <td>${pctBadge}</td>
      <td><div class="ai-suggestion">${sp.aiSuggestion}</div></td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';

  content.innerHTML = html;
}

// ==================== TEAM MANAGEMENT ====================
async function renderTeam() {
  const content = document.getElementById('content-area');
  try {
    state.accounts = await apiGet('/api/accounts');
    state.customers = await apiGet('/api/customers');
  } catch {}

  const supervisors = state.accounts.filter(a => a.role === 'sales_head');
  const soList = state.accounts.filter(a => a.role === 'so');

  let html = `<div class="table-section">
    <div class="table-section-header"><h3>Supervisors (${supervisors.length})</h3></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Territory</th><th>Team Members</th><th>Total SOs</th><th>Actions</th></tr></thead>
      <tbody>`;

  supervisors.forEach(sup => {
    const members = soList.filter(so => so.supervisor === sup.username);
    const memberBadges = members.map(m => `<span class="member-badge">${m.name}</span>`).join(' ');
    html += `<tr>
      <td><strong>${sup.name}</strong></td>
      <td>${sup.username}</td>
      <td>${sup.territory || '-'}</td>
      <td><div class="member-badges">${memberBadges || '<span style="color:var(--gray-400);font-size:12px">No members</span>'}</div></td>
      <td>${members.length}</td>
      <td><button class="btn btn-primary btn-sm" onclick="showTeamAssign('${sup.username}','${sup.name.replace(/'/g,"\\'")}')">Manage Team</button></td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';

  html += `<div class="table-section">
    <div class="table-section-header"><h3>Sales Officers (${soList.length})</h3></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Territory</th><th>Supervisor</th><th>Customers</th><th>Actions</th></tr></thead>
      <tbody>`;

  soList.forEach(so => {
    const sup = state.accounts.find(a => a.username === so.supervisor);
    const custCount = state.customers.filter(c => c.salesperson === so.name).length;
    html += `<tr>
      <td><strong>${so.name}</strong></td>
      <td>${so.username}</td>
      <td>${so.territory || '-'}</td>
      <td>${sup ? `<span class="badge badge-blue">${sup.name}</span>` : '<span class="badge badge-gray">Unassigned</span>'}</td>
      <td>${custCount}</td>
      <td><button class="btn btn-outline btn-sm" onclick="showMemberAssign('${so.username}','${so.name.replace(/'/g,"\\'")}')">Assign</button></td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';
  content.innerHTML = html;
}

async function showTeamAssign(supervisorUsername, supervisorName) {
  await reloadEntity('accounts');
  const soList = state.accounts.filter(a => a.role === 'so');
  let bodyHtml = `<p style="margin-bottom:12px;color:var(--gray-500);font-size:14px">Select team members for <strong>${supervisorName}</strong>:</p>
    <div class="checkbox-list">`;
  soList.forEach(so => {
    const checked = so.supervisor === supervisorUsername ? ' checked' : '';
    bodyHtml += `<div class="checkbox-item">
      <input type="checkbox" id="chk-${so.username}" value="${so.username}"${checked}>
      <label for="chk-${so.username}">${so.name} <span style="color:var(--gray-400);font-size:12px">(${so.territory || 'No territory'})</span></label>
    </div>`;
  });
  bodyHtml += '</div>';

  const footerHtml = `
    <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="saveTeamAssign('${supervisorUsername}')">Save Changes</button>
  `;
  openModal(`Manage Team - ${supervisorName}`, bodyHtml, footerHtml);
}

async function saveTeamAssign(supervisorUsername) {
  const soList = state.accounts.filter(a => a.role === 'so');
  for (const so of soList) {
    const checkbox = document.getElementById('chk-' + so.username);
    const newSupervisor = checkbox && checkbox.checked ? supervisorUsername : (so.supervisor === supervisorUsername ? '' : so.supervisor);
    if (newSupervisor !== so.supervisor) {
      try {
        await apiPut('/api/accounts/' + so.username, { supervisor: newSupervisor });
      } catch {}
    }
  }
  closeModal();
  await reloadEntity('accounts');
  renderPage();
}

async function showMemberAssign(soUsername, soName) {
  await reloadEntity('accounts');
  const supervisors = state.accounts.filter(a => a.role === 'sales_head');
  const currentSo = state.accounts.find(a => a.username === soUsername);
  const currentSup = currentSo ? currentSo.supervisor : '';

  let bodyHtml = `<p style="margin-bottom:12px;color:var(--gray-500);font-size:14px">Assign supervisor for <strong>${soName}</strong>:</p>
    <div class="form-group">
      <label>Supervisor</label>
      <select id="assign-supervisor">
        <option value="">-- Unassigned --</option>`;
  supervisors.forEach(sup => {
    bodyHtml += `<option value="${sup.username}" ${currentSup === sup.username ? 'selected' : ''}>${sup.name} (${sup.territory || 'No territory'})</option>`;
  });
  bodyHtml += '</select></div>';

  const footerHtml = `
    <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="saveMemberAssign('${soUsername}')">Save</button>
  `;
  openModal(`Assign - ${soName}`, bodyHtml, footerHtml);
}

async function saveMemberAssign(soUsername) {
  const supervisor = document.getElementById('assign-supervisor').value;
  try {
    await apiPut('/api/accounts/' + soUsername, { supervisor: supervisor === '' ? '' : supervisor });
  } catch (err) {
    alert('Error: ' + err.message);
  }
  closeModal();
  await reloadEntity('accounts');
  renderPage();
}

// ==================== REPORTS ====================
function renderReports() {
  const content = document.getElementById('content-area');
  content.innerHTML = `<div class="table-section">
    <div class="table-section-header"><h3>Reports</h3></div>
    <div class="empty-state">
      <div class="empty-icon">&#128202;</div>
      <h4>Reports Module</h4>
      <p>Sales reports, performance analytics and export functionality coming soon.</p>
    </div>
  </div>`;
}

// ==================== ACCOUNTS ====================
async function renderAccounts() {
  const content = document.getElementById('content-area');
  try { state.accounts = await apiGet('/api/accounts'); } catch {}

  const headerBtn = document.getElementById('header-action-btn');
  headerBtn.style.display = 'inline-flex';
  headerBtn.textContent = '+ Add User';
  headerBtn.onclick = showAccountForm;

  let html = `<div class="table-section">
    <div class="table-section-header">
      <h3>User Accounts (${state.accounts.length})</h3>
      <button class="btn btn-primary btn-sm" onclick="showAccountForm()">+ Add User</button>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Territory</th><th>Supervisor</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>`;

  state.accounts.forEach(acc => {
    html += `<tr>
      <td><strong>${acc.name}</strong></td>
      <td>${acc.username}</td>
      <td><span class="badge badge-blue">${acc.role.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</span></td>
      <td>${acc.territory || '-'}</td>
      <td>${acc.supervisor || '-'}</td>
      <td style="font-size:12px;color:var(--gray-400)">${new Date(acc.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="showAccountForm(${JSON.stringify(acc).replace(/"/g,'&quot;')})">Edit</button>
        ${acc.username !== state.user.username ? `<button class="btn btn-danger btn-sm" onclick="deleteAccount('${acc.username}')" style="margin-left:4px">Del</button>` : ''}
      </td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';
  content.innerHTML = html;
}

function showAccountForm(existing) {
  const roles = ['super_admin','admin','sales_head','so','contact_center','sales_excellence','management'];
  const supervisors = state.accounts.filter(a => a.role === 'admin' || a.role === 'sales_head').map(a => a.username);

  let bodyHtml = `<div class="form-group">
    <label>Name</label>
    <input type="text" id="af-name" value="${existing ? existing.name : ''}">
  </div>
  <div class="form-group">
    <label>Username</label>
    <input type="text" id="af-username" value="${existing ? existing.username : ''}" ${existing ? 'readonly' : ''}>
  </div>
  <div class="form-group">
    <label>Password ${existing ? '(leave blank to keep current)' : ''}</label>
    <input type="password" id="af-password" placeholder="${existing ? 'New password...' : 'Enter password'}">
  </div>
  <div class="form-group">
    <label>Role</label>
    <select id="af-role">${roles.map(r => `<option value="${r}" ${existing && existing.role === r ? 'selected' : ''}>${r.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}</select>
  </div>
  <div class="form-group">
    <label>Territory</label>
    <input type="text" id="af-territory" value="${existing ? (existing.territory || '') : ''}">
  </div>
  <div class="form-group">
    <label>Supervisor</label>
    <select id="af-supervisor">
      <option value="">-- None --</option>
      ${supervisors.map(s => `<option value="${s}" ${existing && existing.supervisor === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
  </div>`;

  const footerHtml = `
    ${existing ? `<button class="btn btn-danger btn-sm" onclick="deleteAccount('${existing.username}')">Delete</button>` : ''}
    <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="saveAccount('${existing ? existing.username : ''}')">Save</button>
  `;

  const title = existing ? `Edit User - ${existing.name}` : 'New User';
  openModal(title, bodyHtml, footerHtml);
}

async function saveAccount(username) {
  const name = document.getElementById('af-name').value.trim();
  const newUsername = document.getElementById('af-username').value.trim();
  const password = document.getElementById('af-password').value;
  const role = document.getElementById('af-role').value;
  const territory = document.getElementById('af-territory').value.trim();
  const supervisor = document.getElementById('af-supervisor').value;

  if (!newUsername) { alert('Username required'); return; }

  const body = { name, role, territory, supervisor };
  if (password) body.password = password;

  try {
    if (username) {
      await apiPut('/api/accounts/' + username, body);
    } else {
      body.username = newUsername;
      await apiPost('/api/accounts', body);
    }
    closeModal();
    await reloadEntity('accounts');
    renderPage();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteAccount(username) {
  if (!confirm('Delete user ' + username + '? This cannot be undone.')) return;
  try {
    await apiDel('/api/accounts/' + username);
    closeModal();
    await reloadEntity('accounts');
    renderPage();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ==================== INIT ====================
async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('sidebar-avatar').textContent = (state.user.name || state.user.username).charAt(0).toUpperCase();
  document.getElementById('sidebar-name').textContent = state.user.name || state.user.username;
  document.getElementById('sidebar-role').textContent = state.user.role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  state.navHistory = [];
  state.currentTab = 'dashboard';

  try {
    state.accounts = await apiGet('/api/accounts');
    state.customers = await apiGet('/api/customers');
  } catch {}

  renderPage();
}

document.getElementById('login-form').addEventListener('submit', handleLogin);

async function init() {
  const restored = await restoreSession();
  if (restored) {
    showApp();
  } else {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('app').style.display = 'none';
  }
}

init();
