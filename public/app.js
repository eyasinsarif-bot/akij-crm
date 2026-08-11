// NTL CRM - Nobayon Traders Ltd. (BU 211)
// State
const state = { user: null, token: null, currentTab: "dashboard", navHistory: [], customers: [], leads: [], opportunities: [], orders: [], complaints: [], visits: [], accounts: [], targets: [], dashboardData: null, financial: null, fsComponents: [], monthlyData: [], topGL: [], transactions: [] };
const API = "";

// Roles & Nav
const ROLE_HIERARCHY = {
  super_admin: ["dashboard","customers","leads","opportunities","orders","complaints","visits","team","reports","accounts","financials"],
  admin: ["dashboard","customers","leads","opportunities","orders","complaints","visits","team","reports","accounts","financials"],
  sales_head: ["dashboard","customers","leads","opportunities","orders","visits","team","reports"],
  so: ["dashboard","customers","leads","opportunities","orders","visits"],
  contact_center: ["complaints"],
  sales_excellence: ["reports","financials"],
  management: ["dashboard","reports","financials"]
};
const NAV_GROUPS = {
  main: { title: "Main", items: [{ id: "dashboard", label: "Dashboard" }] },
  modules: { title: "CRM Modules", items: [{ id: "customers", label: "Customers" },{ id: "leads", label: "Leads" },{ id: "opportunities", label: "Opportunities" },{ id: "orders", label: "Orders" },{ id: "complaints", label: "Complaints" },{ id: "visits", label: "Visits" }] },
  operations: { title: "Operations", items: [{ id: "team", label: "Team" },{ id: "reports", label: "Reports" },{ id: "accounts", label: "Accounts" }] },
  analytics: { title: "Analytics", items: [{ id: "financials", label: "Financials" }] }
};
const NAV_ICONS = { dashboard: "\u{1F4CA}", customers: "\u{1F465}", leads: "\u{1F3AF}", opportunities: "\u{1F4B0}", orders: "\u{1F6D2}", complaints: "\u{1F6E0}\uFE0F", visits: "\u{1F4CD}", team: "\u{1F465}", reports: "\u{1F4CA}", accounts: "\u2699\uFE0F", financials: "\u{1F4B5}" };

// API helpers
async function api(method, path, body) { const o = { method, headers: { "Content-Type": "application/json" } }; if (state.token) o.headers["Authorization"] = "Bearer " + state.token; if (body) o.body = JSON.stringify(body); const r = await fetch(API + path, o); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Request failed"); return d; }
const apiGet = p => api("GET", p);
const apiPost = (p, b) => api("POST", p, b);
const apiPut = (p, b) => api("PUT", p, b);
const apiDel = p => api("DELETE", p);

// Auth
async function handleLogin(e) { e.preventDefault(); var u = document.getElementById("login-username").value.trim(); var p = document.getElementById("login-password").value; var er = document.getElementById("login-error"); var b = document.getElementById("login-btn"); er.style.display = "none"; b.disabled = true; b.textContent = "Signing in..."; try { var d = await apiPost("/api/login",{username:u,password:p}); state.token = d.token; state.user = d.user; sessionStorage.setItem("ntl_token",d.token); sessionStorage.setItem("ntl_user",JSON.stringify(d.user)); showApp(); } catch(e) { er.textContent = e.message; er.style.display = "block"; b.disabled = false; b.textContent = "Sign In"; } }
async function logout() { try { await apiPost("/api/logout"); } catch(e) {} state.token = null; state.user = null; state.navHistory = []; sessionStorage.clear(); document.getElementById("app").style.display = "none"; document.getElementById("login-screen").style.display = ""; document.getElementById("login-form").reset(); }
async function restoreSession() { var t = sessionStorage.getItem("ntl_token"); if (!t) return false; state.token = t; try { var d = await apiGet("/api/session"); state.user = d.user; return true; } catch(e) { sessionStorage.clear(); state.token = null; return false; } }

// Navigation
function navigate(tab, replace) { if (!state.user) return; var a = ROLE_HIERARCHY[state.user.role] || []; if (!a.includes(tab)) return; if (!replace) state.navHistory.push(state.currentTab); state.currentTab = tab; renderPage(); }
function goBack() { if (state.navHistory.length === 0) return; state.currentTab = state.navHistory.pop(); renderPage(); }
function renderPage() { document.getElementById("back-btn").classList.toggle("visible", state.navHistory.length > 0); document.getElementById("header-action-btn").style.display = "none";   var r = { dashboard: renderDashboard, customers: function(){renderEntityView("customers","Customers")}, leads: function(){renderEntityView("leads","Leads")}, opportunities: function(){renderEntityView("opportunities","Opportunities")}, orders: function(){renderEntityView("orders","Orders")}, complaints: function(){renderEntityView("complaints","Complaints")}, visits: renderVisits, team: renderTeam, reports: renderReports, accounts: renderAccounts, financials: renderFinancials }; var l = { dashboard: "Dashboard - NTL CRM", customers: "Customers", leads: "Leads", opportunities: "Opportunities", orders: "Orders", complaints: "Complaints", visits: "Visits", team: "Team Management", reports: "Reports", accounts: "User Accounts", financials: "Financial Analytics" }; document.getElementById("page-title").textContent = l[state.currentTab] || state.currentTab; updateSidebar(); if (r[state.currentTab]) r[state.currentTab](); }
function updateSidebar() { var n = document.getElementById("sidebar-nav"); var a = ROLE_HIERARCHY[state.user.role] || []; var h = ""; Object.values(NAV_GROUPS).forEach(function(g){ var v = g.items.filter(function(i){return a.includes(i.id)}); if (v.length === 0) return; h += '<div class="nav-section"><div class="nav-section-title">'+g.title+'</div>'; v.forEach(function(i){ h += '<div class="nav-item'+(state.currentTab===i.id?" active":"")+'" onclick="navigate(\''+i.id+'\')"><span class="nav-icon">'+NAV_ICONS[i.id]+'</span> '+i.label+'</div>'; }); h += '</div>'; }); n.innerHTML = h; }
function closeModal() { document.getElementById("modal-overlay").classList.remove("active"); }
document.getElementById("modal-overlay").addEventListener("click", function(e) { if (e.target === this) closeModal(); });
function openModal(title, bodyHtml, footerHtml) { var m = document.getElementById("modal"); m.innerHTML = '<div class="modal-header"><h3>'+title+'</h3><button class="btn-icon" onclick="closeModal()">&times;</button></div><div class="modal-body">'+bodyHtml+'</div>'+(footerHtml?'<div class="modal-footer">'+footerHtml+'</div>':''); document.getElementById("modal-overlay").classList.add("active"); }
function filterTable(id, q) { var t = document.getElementById(id); if (!t) return; t.querySelectorAll("tbody tr").forEach(function(r){ r.style.display = r.textContent.toLowerCase().includes(q.toLowerCase()) ? "" : "none"; }); }

// Entity helpers
async function reloadEntity(ent) { try { state[ent] = await apiGet("/api/"+ent); } catch(e) {} }
function getSONames() { return state.accounts.filter(function(a){return a.role==="so"||a.role==="sales_head"}).map(function(a){return a.name}); }
function getCustomerNames() { return state.customers.map(function(c){return c.name}); }

function buildEntityForm(entity, fields, existing) {
  return fields.map(function(f){
    var v = existing ? (existing[f.name]||"") : "";
    if (f.type === "select") return '<div class="form-group"><label>'+f.label+'</label><select id="ef-'+f.name+'">'+f.options.map(function(o){return '<option value="'+o+'" '+(v===o?"selected":"")+'>'+o+'</option>';}).join("")+'</select></div>';
    if (f.type === "textarea") return '<div class="form-group"><label>'+f.label+'</label><textarea id="ef-'+f.name+'">'+v+'</textarea></div>';
    return '<div class="form-group"><label>'+f.label+'</label><input type="'+(f.type||"text")+'" id="ef-'+f.name+'" value="'+v+'">';
  }).join("");
}

function getEntityFields(ent) {
  var m = {
    customers: [{n:"name",l:"Name"},{n:"phone",l:"Phone"},{n:"email",l:"Email"},{n:"address",l:"Address"},{n:"salesperson",l:"Salesperson",t:"select",o:getSONames()},{n:"status",l:"Status",t:"select",o:["active","inactive","lead"]},{n:"source",l:"Source",t:"select",o:["Referral","Walk-in","Website","Cold Call","Trade Show","Social Media","Email Campaign","Existing"]}],
    leads: [{n:"name",l:"Name"},{n:"phone",l:"Phone"},{n:"email",l:"Email"},{n:"source",l:"Source",t:"select",o:["Website","Referral","Walk-in","Trade Show","Cold Call","Social Media","Email Campaign"]},{n:"status",l:"Status",t:"select",o:["new","contacted","qualified","proposal","lost","converted"]},{n:"salesperson",l:"Salesperson",t:"select",o:getSONames()},{n:"value",l:"Value (BDT)",t:"number"},{n:"notes",l:"Notes",t:"textarea"}],
    opportunities: [{n:"name",l:"Opportunity Name"},{n:"customer",l:"Customer"},{n:"salesperson",l:"Salesperson",t:"select",o:getSONames()},{n:"stage",l:"Stage",t:"select",o:["Qualification","Proposal","Negotiation","Closed Won","Closed Lost"]},{n:"value",l:"Value (BDT)",t:"number"},{n:"probability",l:"Probability (%)",t:"number"},{n:"expected_close",l:"Expected Close",t:"date"}],
    orders: [{n:"customer",l:"Customer"},{n:"salesperson",l:"Salesperson",t:"select",o:getSONames()},{n:"product",l:"Product"},{n:"quantity",l:"Quantity",t:"number"},{n:"unit_price",l:"Unit Price (BDT)",t:"number"},{n:"total",l:"Total (BDT)",t:"number"},{n:"status",l:"Status",t:"select",o:["pending","processing","delivered","cancelled"]},{n:"order_date",l:"Order Date",t:"date"},{n:"delivery_date",l:"Delivery Date",t:"date"}],
    complaints: [{n:"customer",l:"Customer"},{n:"subject",l:"Subject"},{n:"description",l:"Description",t:"textarea"},{n:"priority",l:"Priority",t:"select",o:["low","medium","high","critical"]},{n:"status",l:"Status",t:"select",o:["open","in_progress","resolved","closed"]},{n:"assigned_to",l:"Assigned To"}],
    visits: [{n:"customer",l:"Customer"},{n:"salesperson",l:"Salesperson",t:"select",o:getSONames()},{n:"purpose",l:"Purpose",t:"select",o:["Follow-up","New product intro","Order collection","Site inspection","Product demo","Relationship building","Complaint resolution"]},{n:"outcome",l:"Outcome",t:"select",o:["Positive","Interested","Completed","Pending","No response"]},{n:"visit_date",l:"Visit Date",t:"date"},{n:"next_visit",l:"Next Visit",t:"date"}]
  };
  return m[ent] || [];
}

function showEntityForm(entity, existing) {
  var f = getEntityFields(entity);
  var id = existing ? existing.id : null;
  var title = existing ? "Edit " + entity.slice(0,-1) : "New " + entity.slice(0,-1);
  var body = buildEntityForm(entity, f, existing);
  var footer = (id ? '<button class="btn btn-danger btn-sm" onclick="deleteEntity(\''+entity+'\',\''+id+'\')">Delete</button> ' : '') +
    '<button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button> ' +
    '<button class="btn btn-primary btn-sm" onclick="saveEntity(\''+entity+'\',\''+(id||"")+'\')">Save</button>';
  openModal(title, body, footer);
}

async function saveEntity(ent, id) {
  var f = getEntityFields(ent);
  var body = {};
  f.forEach(function(fd){ var el = document.getElementById("ef-"+fd.n); if (el) body[fd.n] = fd.t === "number" ? Number(el.value)||0 : el.value; });
  if (ent === "orders" && body.quantity && body.unit_price && !body.total) body.total = body.quantity * body.unit_price;
  try { if (id) await apiPut("/api/"+ent+"/"+id, body); else await apiPost("/api/"+ent, body); closeModal(); await reloadEntity(ent); renderPage(); }
  catch(e) { alert("Error: "+e.message); }
}

async function deleteEntity(ent, id) {
  if (!confirm("Delete this record?")) return;
  try { await apiDel("/api/"+ent+"/"+id); closeModal(); await reloadEntity(ent); renderPage(); }
  catch(e) { alert("Error: "+e.message); }
}

async function renderEntityView(ent, title) {
  var c = document.getElementById("content-area");
  var hb = document.getElementById("header-action-btn");
  hb.style.display = "inline-flex"; hb.textContent = "+ Add " + title.slice(0,-1); hb.onclick = function(){ showEntityForm(ent, null); };
  if (ent === "customers") { try { var cd = await apiGet("/api/customers/dwh"); if (cd && cd.length > 0) state.customers = cd; } catch(e) { console.log("DWH error, using cached:",e.message); } }
  else if (ent === "leads") { try { var ld = await apiGet("/api/leads/dwh"); if (ld && ld.length > 0) state.leads = ld; } catch(e) { console.log("DWH error:",e.message); } }
  else if (ent === "orders") { try { var od = await apiGet("/api/orders/dwh"); if (od && od.length > 0) state.orders = od; } catch(e) { console.log("DWH error:",e.message); } }
  else if (ent === "opportunities") { try { var op = await apiGet("/api/opportunities/dwh"); if (op && op.length > 0) state.opportunities = op; } catch(e) { console.log("DWH error:",e.message); } }
  else if (ent === "complaints") { try { var cp = await apiGet("/api/complaints/dwh"); if (cp && cp.length > 0) state.complaints = cp; } catch(e) { console.log("DWH error:",e.message); } }
  else if (!state[ent] || state[ent].length === 0) { try { await reloadEntity(ent); } catch(e) {} }
  var data = state[ent] || [];
  var h = '<div class="table-section"><div class="table-section-header"><h3>'+title+' ('+data.length+')</h3><div class="toolbar"><input type="text" class="search-box" placeholder="Search..." oninput="filterTable(\''+ent+'-table\',this.value)"><button class="btn btn-primary btn-sm" onclick="showEntityForm(\''+ent+'\',null)">+ Add</button></div></div>';
  if (data.length === 0) {
    h += '<div class="empty-state"><div class="empty-icon">&#128203;</div><h4>No records found</h4><p>Click + Add to create the first one.</p></div>';
  } else {
    h += '<div style="overflow-x:auto"><table id="'+ent+'-table"><thead><tr>';
    var cols = ent === "customers" ? ["name","phone","email","address","salesperson","status","source"] : ent === "orders" ? ["customer","salesperson","product","quantity","unit_price","total","status","order_date","delivery_date"] : Object.keys(data[0]).filter(function(k){ return k !== "created_at" && k !== "updated_at"; });
    cols.forEach(function(k){ h += '<th>'+k.replace(/_/g," ").replace(/\b\w/g,function(l){return l.toUpperCase()})+'</th>'; });
    h += '<th style="width:80px">Actions</th></tr></thead><tbody>';
    data.forEach(function(d){
      h += '<tr class="clickable" onclick="showEntityForm(\''+ent+'\','+JSON.stringify(d).replace(/"/g,"&quot;")+')">';
      cols.forEach(function(k){
        var v = d[k] || "";
        if (k === "status") v = '<span class="badge badge-'+(v==="active"||v==="delivered"||v==="resolved"||v==="converted"||v==="Closed Won"?"green":v==="inactive"||v==="lost"||v==="Closed Lost"||v==="cancelled"?"red":"amber")+'">'+v+'</span>';
        if (k === "priority") v = '<span class="badge badge-'+(v==="critical"||v==="high"?"red":v==="medium"?"amber":"green")+'">'+v+'</span>';
        if (k === "value"||k==="total"||k==="unit_price") v = v ? "Tk "+Number(v).toLocaleString() : "-";
        h += '<td>'+v+'</td>';
      });
      h += '<td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();showEntityForm(\''+ent+'\','+JSON.stringify(d).replace(/"/g,"&quot;")+')">Edit</button></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>'; c.innerHTML = h;
}

// ==================== DASHBOARD ====================
async function renderDashboard() {
  var c = document.getElementById("content-area");
  c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-400)">Loading dashboard...</div>';
  try { state.dashboardData = await apiGet("/api/dashboard/stats"); } catch(e) { c.innerHTML = '<div class="alert alert-error">Failed to load</div>'; return; }
  var data = state.dashboardData;
  var kpi = data.kpi;
  var sp = data.spPerformance;
  var fin = data.financial;
  var bu = data.buInfo;
  var h = '<div class="kpi-grid">';
  var cards = [
    { l:"Total Customers", v:kpi.totalCustomers, s:kpi.newThisMonth+" new", n:"customers", cl:"navy" },
    { l:"Open Leads", v:kpi.openLeads, s:"Active leads", n:"leads", cl:"cyan" },
    { l:"Pipeline Value", v:(kpi.pipelineValue/10000000).toFixed(2)+" Cr", s:"Active opps", n:"opportunities", cl:"green" },
    { l:"Pending Orders", v:kpi.pendingOrders, s:"Awaiting", n:"orders", cl:"amber" },
    { l:"Total Orders", v:(kpi.totalSales/10000000).toFixed(2)+" Cr", s:kpi.totalOrders+" orders", n:"orders", cl:"navy" },
    { l:"Open Complaints", v:kpi.openComplaints, s:"Awaiting resolution", n:"complaints", cl:"red" },
    { l:"Total Visits", v:kpi.totalVisits, s:"Field visits", n:"visits", cl:"cyan" },
    { l:"New This Month", v:kpi.newThisMonth, s:"Out of "+kpi.totalCustomers, n:"customers", cl:"green" }
  ];
  cards.forEach(function(ca){ h += '<div class="stat-card '+ca.cl+'" onclick="navigate(\''+ca.n+'\')"><div class="stat-label">'+ca.l+'</div><div class="stat-value">'+ca.v+'</div><div class="stat-sub">'+ca.s+'</div></div>'; });
  h += '</div>';

  if (fin) {
    var rev = Math.abs(fin.totalRevenue)||0;
    var gp = rev - fin.cogs;
    var totalOpex = fin.opex + fin.financialExp + fin.tax;
    h += '<div style="margin-bottom:12px"><h3 style="color:var(--gray-700)">Nobayon Traders Ltd. (BU 211) - Financial Overview</h3></div>';
    h += '<div class="kpi-grid">';
[{ l:"Revenue", v:(rev/10000000).toFixed(2)+" Cr", s:fin.totalTx+" tx", n:"financials", cl:"navy" },
     { l:"COGS", v:(fin.cogs/10000000).toFixed(2)+" Cr", s:"Cost of goods", n:"financials", cl:"red" },
     { l:"Gross Profit", v:(gp/10000000).toFixed(2)+" Cr", s:((gp/rev)*100).toFixed(1)+"% margin", n:"financials", cl:"green" },
     { l:"OpEx", v:(totalOpex/10000000).toFixed(2)+" Cr", s:"OpEx+Finance+Tax", n:"financials", cl:"amber" },
     { l:"Net Income", v:(Math.abs(fin.netIncome)/10000000).toFixed(2)+" Cr", s:fin.netIncome<0?"Net Loss":"Net Profit", n:"financials", cl:fin.netIncome<0?"red":"green" },
     { l:"GL Accounts", v:fin.glAccounts, s:"Active accounts", n:"financials", cl:"cyan" },
     { l:"Profit Centers", v:fin.profitCenters, s:"Units", n:"financials", cl:"navy" },
     { l:"BU Info", v:bu.code, s:bu.group+" / "+bu.subGroup, n:"financials", cl:"amber" }
    ].forEach(function(ca){ h += '<div class="stat-card '+ca.cl+'" onclick="navigate(\''+ca.n+'\')"><div class="stat-label">'+ca.l+'</div><div class="stat-value">'+ca.v+'</div><div class="stat-sub">'+ca.s+'</div></div>'; });
    h += '</div>';
  }

  h += '<div class="table-section"><div class="table-section-header"><h3>Salesperson Performance</h3><span style="font-size:12px;color:var(--gray-400)">Aug 2026</span></div>';
  h += '<div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Territory</th><th>Customers</th><th>Visits</th><th>Target (Tk)</th><th>Achieved (Tk)</th><th>%</th><th>AI Suggestion</th></tr></thead><tbody>';
  sp.forEach(function(s){
    var pctB = s.pct===null?'<span class="badge badge-gray">N/A</span>':s.pct>=100?'<span class="badge badge-green">'+s.pct+'%</span>':s.pct>=70?'<span class="badge badge-amber">'+s.pct+'%</span>':'<span class="badge badge-red">'+s.pct+'%</span>';
    h += '<tr class="clickable" onclick="navigate(\'customers\')"><td><strong>'+s.name+'</strong><br><span style="font-size:11px;color:var(--gray-400)">'+(s.role||"").replace("_"," ").replace(/\b\w/g,function(l){return l.toUpperCase()})+'</span></td><td>'+s.territory+'</td><td>'+s.customers+'</td><td>'+s.visits+'</td><td>Tk '+s.targetSales.toLocaleString()+'</td><td>Tk '+s.achievedSales.toLocaleString()+'</td><td>'+pctB+'</td><td><div class="ai-suggestion">'+s.aiSuggestion+'</div></td></tr>';
  });
  h += '</tbody></table></div></div>';
  c.innerHTML = h;
}

// ==================== VISITS (3 Sections) ====================
var _visitsTab = 'sales';
function renderVisits(){
  var c=document.getElementById("content-area");
  var hb=document.getElementById("header-action-btn");
  hb.style.display='inline-flex'; hb.textContent='+ Add Visit'; hb.onclick=function(){showVisitForm();};
  try { state.visits = await apiGet("/api/visits"); } catch(e){}
  var data = state.visits || [];
  var tabs=[{id:'sales',label:'Sales Visits'},{id:'purchase',label:'Purchase Visits'},{id:'quality_control',label:'Quality Control'}];
  var filtered=data.filter(function(v){return v.visit_type===_visitsTab;});
  var h='<div class="table-section"><div class="table-section-header"><h3>Visit Management</h3><div class="toolbar"><button class="btn btn-primary btn-sm" onclick="showVisitForm()">+ Add Visit</button></div></div>';
  h+='<div style="display:flex;gap:8px;padding:12px 20px;border-bottom:1px solid var(--gray-200);background:var(--gray-50)">';
  tabs.forEach(function(t){ h+='<button class="btn '+(t.id===_visitsTab?'btn-primary':'btn-outline')+' btn-sm" onclick="_visitsTab=\''+t.id+'\';renderVisits();">'+t.label+' <span style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px;font-size:11px">'+(data.filter(function(v){return v.visit_type===t.id}).length)+'</span></button>'; });
  h+='</div>';
  h+='<div style="padding:0">';
  if (filtered.length===0){ h+='<div class="empty-state"><div class="empty-icon">&#128203;</div><h4>No '+_visitsTab.replace('_',' ')+' visits</h4><p>Click + Add to log a visit.</p></div>'; }
  else {
    h+='<div style="overflow-x:auto"><table id="visits-table"><thead><tr><th>Customer</th><th>Visitor</th><th>Purpose</th><th>Outcome</th><th>Visit Date</th><th>Next Visit</th><th>Notes</th><th style="width:80px">Actions</th></tr></thead><tbody>';
    filtered.forEach(function(v){
      h+='<tr class="clickable" onclick="showVisitForm('+JSON.stringify(v).replace(/"/g,'&quot;')+')"><td><strong>'+v.customer+'</strong></td><td>'+v.salesperson+'</td><td>'+v.purpose+'</td><td><span class="badge badge-'+(v.outcome==='Positive'||v.outcome==='Completed'?'green':v.outcome==='Interested'?'cyan':'amber')+'">'+v.outcome+'</span></td><td>'+v.visit_date+'</td><td>'+v.next_visit+'</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+v.notes+'">'+v.notes+'</td><td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();showVisitForm('+JSON.stringify(v).replace(/"/g,'&quot;')+')">Edit</button></td></tr>';
    });
    h+='</tbody></table></div>';
  }
  h+='</div></div>'; c.innerHTML=h;
}

function showVisitForm(existing){
  var fields=[{n:'customer',l:'Customer'},{n:'salesperson',l:'Visitor'},{n:'visit_type',l:'Visit Type',t:'select',o:['sales','purchase','quality_control'],v:_visitsTab},{n:'purpose',l:'Purpose',t:'select',o:['Follow-up','New product intro','Order collection','Site inspection','Product demo','Relationship building','Complaint resolution','Vendor audit','Supplier meeting','Quality inspection','Sample collection']},{n:'outcome',l:'Outcome',t:'select',o:['Positive','Interested','Completed','Pending','No response']},{n:'visit_date',l:'Visit Date',t:'date'},{n:'next_visit',l:'Next Visit',t:'date'},{n:'notes',l:'Notes',t:'textarea'}];
  var body=fields.map(function(f){ var v=existing?(existing[f.n]||''):(f.v||''); if (f.t==='select') return '<div class="form-group"><label>'+f.l+'</label><select id="vf-'+f.n+'">'+f.o.map(function(o){return '<option value="'+o+'"'+(v===o?' selected':'')+'>'+o.replace(/_/g,' ').replace(/\b\w/g,function(l){return l.toUpperCase()})+'</option>';}).join('')+'</select></div>'; if (f.t==='textarea') return '<div class="form-group"><label>'+f.l+'</label><textarea id="vf-'+f.n+'">'+v+'</textarea></div>'; return '<div class="form-group"><label>'+f.l+'</label><input type="'+(f.t||'text')+'" id="vf-'+f.n+'" value="'+v+'">'; }).join('');
  var id=existing?existing.id:null;
  var footer=(id?'<button class="btn btn-danger btn-sm" onclick="deleteVisit(\''+id+'\')">Delete</button> ':'')+'<button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button> <button class="btn btn-primary btn-sm" onclick="saveVisit(\''+(id||'')+'\')">Save</button>';
  openModal(existing?'Edit Visit':'New Visit',body,footer);
}

async function saveVisit(id){
  var fields=['customer','salesperson','visit_type','purpose','outcome','visit_date','next_visit','notes'];
  var body={};
  fields.forEach(function(f){ var el=document.getElementById('vf-'+f); if(el) body[f]=el.value; });
  try { if(id) await apiPut('/api/visits/'+id,body); else await apiPost('/api/visits',body); closeModal(); state.visits=await apiGet('/api/visits'); renderVisits(); } catch(e){ alert('Error: '+e.message); }
}

async function deleteVisit(id){
  if(!confirm('Delete this visit?')) return;
  try { await apiDel('/api/visits/'+id); closeModal(); state.visits=await apiGet('/api/visits'); renderVisits(); } catch(e){ alert('Error: '+e.message); }
}

// ==================== TEAM MANAGEMENT ====================
async function renderTeam() {
  var c = document.getElementById("content-area");
  try { var emps = await apiGet("/api/employees/dwh"); if (emps && emps.length > 0) state._employees = emps; } catch(e) {}
  var employees = state._employees || [];
  if (employees.length === 0) { try { state.accounts = await apiGet("/api/accounts"); state.customers = await apiGet("/api/customers"); } catch(e) {} }
  else {
    state.accounts = employees.map(function(e, i){ return { username: e.code||('EMP'+i), name: e.name||'', role: e.designation||'so', territory: e.supervisor||'', supervisor: e.supervisor||'', created_at: '' }; });
  }
  var supervisors = [], seen = {};
  employees.forEach(function(e){ if (e.supervisor && !seen[e.supervisor]) { seen[e.supervisor]=true; supervisors.push({name:e.supervisor, role:e.supervisor_role||'', count:0, members:[]}); } });
  employees.forEach(function(e){ var s=supervisors.find(function(su){return su.name===e.supervisor}); if(s){s.count++;s.members.push(e);} });
  supervisors.sort(function(a,b){return b.count-a.count;});
  var h='<div class="table-section"><div class="table-section-header"><h3>Team Structure - Nobayon Traders ('+employees.length+' employees)</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Supervisor</th><th>Role</th><th>Team</th><th>Members</th></tr></thead><tbody>';
  supervisors.forEach(function(s){ var bdg=s.members.map(function(m){return '<span class="member-badge">'+m.name+'</span>';}).join(' '); h+='<tr><td><strong>'+s.name+'</strong></td><td>'+s.role+'</td><td>'+s.count+'</td><td><div class="member-badges">'+(bdg||'<span style="color:var(--gray-400);font-size:12px">None</span>')+'</div></td></tr>'; });
  h+='</tbody></table></div></div><div class="table-section"><div class="table-section-header"><h3>All Employees ('+employees.length+')</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Designation</th><th>Code</th><th>Supervisor</th><th>Supervisor Role</th></tr></thead><tbody>';
  employees.forEach(function(e){ h+='<tr><td><strong>'+e.name+'</strong></td><td><span class="badge badge-blue">'+e.designation+'</span></td><td>'+e.code+'</td><td>'+e.supervisor+'</td><td>'+e.supervisor_role+'</td></tr>'; });
  h+='</tbody></table></div></div>'; c.innerHTML=h;

// Team management is read-only from DWH employee data
}

// ==================== REPORTS ====================
function renderReports() {
  document.getElementById("content-area").innerHTML = '<div class="table-section"><div class="table-section-header"><h3>Reports</h3></div><div class="empty-state"><div class="empty-icon">&#128202;</div><h4>Reports Module</h4><p>Sales reports, performance analytics, and financial reports available.</p></div></div>';
}

// ==================== ACCOUNTS ====================
async function renderAccounts() {
  var c = document.getElementById("content-area");
  try { state.accounts = await apiGet("/api/accounts"); } catch(e) {}
  var hb = document.getElementById("header-action-btn");
  hb.style.display = "inline-flex"; hb.textContent = "+ Add User"; hb.onclick = function(){ showAccountForm(); };
  var h = '<div class="table-section"><div class="table-section-header"><h3>User Accounts ('+state.accounts.length+')</h3><button class="btn btn-primary btn-sm" onclick="showAccountForm()">+ Add User</button></div><div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Territory</th><th>Supervisor</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
  state.accounts.forEach(function(a){
    h += '<tr><td><strong>'+a.name+'</strong></td><td>'+a.username+'</td><td><span class="badge badge-blue">'+a.role.replace(/_/g," ").replace(/\b\w/g,function(l){return l.toUpperCase()})+'</span></td><td>'+(a.territory||"-")+'</td><td>'+(a.supervisor||"-")+'</td><td style="font-size:12px;color:var(--gray-400)">'+new Date(a.created_at).toLocaleDateString()+'</td><td><button class="btn btn-outline btn-sm" onclick="showAccountForm('+JSON.stringify(a).replace(/"/g,"&quot;")+')">Edit</button>'+(a.username!==state.user.username?' <button class="btn btn-danger btn-sm" onclick="deleteAccount(\''+a.username+'\')">Del</button>':"")+'</td></tr>';
  });
  h += '</tbody></table></div></div>';
  c.innerHTML = h;
}

function showAccountForm(existing) {
  var roles = ["super_admin","admin","sales_head","so","contact_center","sales_excellence","management"];
  var sups = state.accounts.filter(function(a){return a.role==="admin"||a.role==="sales_head"}).map(function(a){return a.username});
  var body = '<div class="form-group"><label>Name</label><input type="text" id="af-name" value="'+(existing?existing.name:"")+'"></div>';
  body += '<div class="form-group"><label>Username</label><input type="text" id="af-username" value="'+(existing?existing.username:"")+'" '+(existing?"readonly":"")+'></div>';
  body += '<div class="form-group"><label>Password '+(existing?"(leave blank to keep)":"")+'</label><input type="password" id="af-password" placeholder="'+(existing?"New password...":"Enter password")+'"></div>';
  body += '<div class="form-group"><label>Role</label><select id="af-role">'+roles.map(function(r){return '<option value="'+r+'"'+(existing&&existing.role===r?" selected":"")+'>'+r.replace(/_/g," ").replace(/\b\w/g,function(l){return l.toUpperCase()})+'</option>';}).join("")+'</select></div>';
  body += '<div class="form-group"><label>Territory</label><input type="text" id="af-territory" value="'+(existing&&existing.territory?existing.territory:"")+'"></div>';
  body += '<div class="form-group"><label>Supervisor</label><select id="af-supervisor"><option value="">-- None --</option>'+sups.map(function(s){return '<option value="'+s+'"'+(existing&&existing.supervisor===s?" selected":"")+'>'+s+'</option>';}).join("")+'</select></div>';
  var footer = (existing?'<button class="btn btn-danger btn-sm" onclick="deleteAccount(\''+existing.username+'\')">Delete</button> ':'')+'<button class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button> <button class="btn btn-primary btn-sm" onclick="saveAccount(\''+(existing?existing.username:"")+'\')">Save</button>';
  openModal(existing?"Edit User - "+existing.name:"New User", body, footer);
}

async function saveAccount(un) {
  var n = document.getElementById("af-name").value.trim();
  var nu = document.getElementById("af-username").value.trim();
  var pw = document.getElementById("af-password").value;
  var r = document.getElementById("af-role").value;
  var t = document.getElementById("af-territory").value.trim();
  var sp = document.getElementById("af-supervisor").value;
  if (!nu) { alert("Username required"); return; }
  var body = { name:n, role:r, territory:t, supervisor:sp };
  if (pw) body.password = pw;
  try { if (un) await apiPut("/api/accounts/"+un, body); else { body.username = nu; await apiPost("/api/accounts", body); } closeModal(); await reloadEntity("accounts"); renderPage(); }
  catch(e) { alert("Error: "+e.message); }
}

async function deleteAccount(un) {
  if (!confirm("Delete user "+un+"?")) return;
  try { await apiDel("/api/accounts/"+un); closeModal(); await reloadEntity("accounts"); renderPage(); }
  catch(e) { alert("Error: "+e.message); }
}

// ==================== FINANCIALS ====================
function fmtCr(n) { return (Math.abs(n||0)/10000000).toFixed(2) + " Cr"; }
function isNeg(n) { return n < 0; }

async function renderFinancials() {
  var c = document.getElementById("content-area");
  c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-400)">Loading financial data from DataMart...</div>';
  try {
    state.financial = await apiGet("/api/financial/summary");
    state.fsComponents = await apiGet("/api/financial/fs-components");
    state.monthlyData = await apiGet("/api/financial/monthly");
    state.topGL = await apiGet("/api/financial/top-gl");
  } catch(e) { c.innerHTML = '<div class="alert alert-error">Failed: '+e.message+'</div>'; return; }

  var fi = state.financial;
  var rev = Math.abs(fi.totalRevenue)||0;
  var gp = rev - fi.cogs;
  var opex = fi.opex + fi.financialExp + fi.tax;

  var h = '<h3 style="margin-bottom:12px">Nobayon Traders Ltd. (BU 211)</h3><div class="kpi-grid">';
  [
    { l:"Revenue", v:fmtCr(rev), s:fi.totalTx+" tx", cl:"navy" },
    { l:"COGS", v:fmtCr(fi.cogs), s:((fi.cogs/rev)*100).toFixed(1)+"% of rev", cl:"red" },
    { l:"Gross Profit", v:fmtCr(gp), s:((gp/rev)*100).toFixed(1)+"% margin", cl:"green" },
    { l:"Operating Exp", v:fmtCr(opex), s:((opex/rev)*100).toFixed(1)+"% of rev", cl:"amber" },
    { l:"Net Income", v:fmtCr(Math.abs(fi.netIncome)), s:isNeg(fi.netIncome)?"Net Loss":"Net Profit", cl:isNeg(fi.netIncome)?"red":"green" },
    { l:"GL Accounts", v:fi.glAccounts, s:"Active accounts", cl:"cyan" }
  ].forEach(function(ca){ h += '<div class="stat-card '+ca.cl+'"><div class="stat-label">'+ca.l+'</div><div class="stat-value">'+ca.v+'</div><div class="stat-sub">'+ca.s+'</div></div>'; });
  h += '</div>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

  h += '<div class="table-section"><div class="table-section-header"><h3>P&L Components</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Component</th><th style="text-align:right">Amount</th><th style="text-align:right">Tx</th></tr></thead><tbody>';
  state.fsComponents.forEach(function(co){ h += '<tr><td>'+co.name+'</td><td style="text-align:right;font-weight:600;color:'+(isNeg(co.totalAmount)?"var(--green)":"var(--red)")+'">'+fmtCr(co.totalAmount)+'</td><td style="text-align:right">'+co.txCount+'</td></tr>'; });
  h += '</tbody></table></div></div>';

  h += '<div class="table-section"><div class="table-section-header"><h3>Monthly Revenue</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Month</th><th style="text-align:right">Revenue</th><th style="text-align:right">Net</th><th style="text-align:right">Tx</th></tr></thead><tbody>';
  state.monthlyData.slice(-12).forEach(function(m){ h += '<tr><td>'+m.month+'</td><td style="text-align:right;color:var(--green);font-weight:600">'+fmtCr(m.revenue)+'</td><td style="text-align:right;font-weight:600;color:'+(m.netIncome<0?"var(--red)":"var(--green)")+'">'+fmtCr(Math.abs(m.netIncome))+'</td><td style="text-align:right">'+m.txCount+'</td></tr>'; });
  h += '</tbody></table></div></div></div>';

  h += '<div class="table-section"><div class="table-section-header"><h3>Top 30 GL Accounts</h3><input type="text" class="search-box" placeholder="Search..." oninput="filterTable(\'gl-tbl\',this.value)" style="width:250px"></div><div style="overflow-x:auto"><table id="gl-tbl"><thead><tr><th>Sub GL</th><th>GL Account</th><th>Component</th><th style="text-align:right">Amount</th><th style="text-align:right">Tx</th></tr></thead><tbody>';
  state.topGL.forEach(function(g){
    h += '<tr><td><strong>'+g.name+'</strong></td><td>'+g.glName+'</td><td><span class="badge badge-blue">'+g.component+'</span></td><td style="text-align:right;font-weight:600;color:'+(isNeg(g.totalAmount)?"var(--green)":"var(--red)")+'">'+fmtCr(g.totalAmount)+'</td><td style="text-align:right">'+g.txCount+'</td></tr>';
  });
  h += '</tbody></table></div></div>';
  c.innerHTML = h;
}

// ==================== INIT ====================
async function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("sidebar-avatar").textContent = (state.user.name||state.user.username).charAt(0).toUpperCase();
  document.getElementById("sidebar-name").textContent = state.user.name||state.user.username;
  document.getElementById("sidebar-role").textContent = (state.user.role||"").replace(/_/g," ").replace(/\b\w/g,function(l){return l.toUpperCase()});
  state.navHistory = []; state.currentTab = "dashboard";
  try { state.accounts = await apiGet("/api/accounts"); try { var cd = await apiGet("/api/customers/dwh"); if (cd && cd.length > 0) state.customers = cd; else state.customers = await apiGet("/api/customers"); } catch(e) { state.customers = await apiGet("/api/customers"); } } catch(e) {}
  renderPage();
}

document.getElementById("login-form").addEventListener("submit", handleLogin);

(async function init() {
  var r = await restoreSession();
  if (r) showApp();
  else { document.getElementById("login-screen").style.display = ""; document.getElementById("app").style.display = "none"; }
})();
