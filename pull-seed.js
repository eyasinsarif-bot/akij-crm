const sql = require('mssql');
const fs = require('fs');

async function main() {
  const config = {
    server: '203.202.241.211', port: 1433, database: 'DWH',
    user: 'mcp_user', password: 'iAOS@35o997',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 60000
  };
  try {
    await sql.connect(config);
    console.log('Connected to DWH');

    // 1. Customers (partner_type=Customer)
    const custRaw = await sql.query("SELECT strBusinessPartnerName as name, strContactNumber as phone, strEmail as email, strBusinessPartnerAddress as address, strPartnerSalesType as partner_type, strDistrictName as district, isActive, strBIN as bin, strBusinessPartnerCode as code, dteLastActionDateTime as last_active FROM prt.tblBusinessPartnerArc WHERE intBusinessUnitId=211 AND isActive=1 AND strPartnerSalesType='Customer' ORDER BY strBusinessPartnerName");
    const customers = custRaw.recordset.map((r,i) => ({
      id: 'BP-' + String(i+1).padStart(4,'0'), name: r.name||'Unknown', phone: r.phone||'', email: r.email||'',
      address: r.address||'', salesperson: r.partner_type||'', status: r.isActive?'active':'inactive',
      source: r.district||'', code: r.code||'', bin: r.bin||'',
      last_active: r.last_active ? new Date(r.last_active).toLocaleDateString('en-BD') : '', created_at: new Date().toISOString()
    }));
    console.log('Customers:', customers.length);

    // 2. Leads (uncompleted orders)
    const leadsRaw = await sql.query("SELECT h.strSalesOrderCode, h.dteSalesOrderDate, h.strSoldToPartnerName as customer, h.numTotalOrderValue as value, h.isCompleted, h.isApproved, h.isRejected, h.strPaymentTermsName, h.strSalesOfficeName, p.strContactNumber as phone, p.strEmail as email, p.strDistrictName FROM oms.tblSalesOrderHeaderArc h LEFT JOIN prt.tblBusinessPartnerArc p ON h.strSoldToPartnerName = p.strBusinessPartnerName AND p.intBusinessUnitId=h.intBusinessUnitId WHERE h.intBusinessUnitId=211 AND h.isCompleted=0 ORDER BY h.dteSalesOrderDate DESC");
    const leads = leadsRaw.recordset.map((r,i) => ({
      id: 'L-'+String(i+1).padStart(4,'0'), name: r.customer||'Unknown', phone: r.phone||'', email: r.email||'',
      source: r.strDistrictName||'', status: r.isRejected?'lost':(r.isApproved?'qualified':'new'),
      salesperson: r.strSalesOfficeName||'', supervisor: 'Kazi Sibbir Ahammad (CBO)',
      notes: (r.strPaymentTermsName||'N/A')+' | '+r.strSalesOrderCode, value: r.value||0, created_at: new Date().toISOString()
    }));
    console.log('Leads:', leads.length);

    // 3. Opportunities (top by value)
    const oppRaw = await sql.query("SELECT TOP 200 strSalesOrderCode, dteSalesOrderDate, strSoldToPartnerName as customer, numTotalOrderValue as value, isCompleted, isApproved, isRejected, strPaymentTermsName, strSalesOfficeName, dteDueShippingDate FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=211 AND (isCompleted=0 OR isRejected=1 OR numTotalOrderValue > 5000000) ORDER BY numTotalOrderValue DESC");
    const opportunities = oppRaw.recordset.map((r,i) => ({
      id: 'OPP-'+String(i+1).padStart(4,'0'), name: r.customer+' - '+r.strSalesOrderCode, customer: r.customer||'Unknown',
      salesperson: r.strSalesOfficeName||'', stage: r.isCompleted?'Closed Won':(r.isRejected?'Closed Lost':'Negotiation'),
      value: r.value||0, probability: r.isCompleted?100:(r.isApproved?70:30),
      expected_close: r.dteDueShippingDate ? new Date(r.dteDueShippingDate).toISOString().slice(0,10) : '', created_at: new Date().toISOString()
    }));
    console.log('Opportunities:', opportunities.length);

    // 4. Orders
    const ordRaw = await sql.query("SELECT TOP 500 h.strSalesOrderCode as order_code, h.dteSalesOrderDate as order_date, h.strSoldToPartnerName as customer, h.numTotalOrderValue as total, h.isCompleted, h.isApproved, h.strPaymentTermsName, h.strSalesOfficeName, h.dteDueShippingDate, r.strItemName as product, r.numOrderQuantity as quantity, r.numItemPrice as unit_price, r.strUOM as uom FROM oms.tblSalesOrderHeaderArc h LEFT JOIN oms.tblSalesOrderRowArc r ON h.intSalesOrderId = r.intSalesOrderId AND r.intSequenceNo = 1 WHERE h.intBusinessUnitId=211 ORDER BY h.dteSalesOrderDate DESC");
    const orders = ordRaw.recordset.map((r,i) => ({
      id: 'SO-'+String(i+1).padStart(5,'0'), customer: r.customer||'Unknown', salesperson: r.strSalesOfficeName||'',
      product: r.product||'', quantity: r.quantity||0, unit_price: r.unit_price||0, total: r.total||0,
      status: r.isCompleted?'delivered':(r.isApproved?'processing':'pending'),
      order_date: r.order_date ? new Date(r.order_date).toISOString().slice(0,10) : '',
      delivery_date: r.due_date ? new Date(r.due_date).toISOString().slice(0,10) : '', created_at: new Date().toISOString()
    }));
    console.log('Orders:', orders.length);

    // 5. Complaints (sales returns)
    const compRaw = await sql.query("SELECT TOP 200 intSalesReturnId, strSalesOrderNo, strBusinessPartnerName as customer, dteReturnDateTime, numTotalReturnQty, strReassons as reason, isActive, isClosed, strPlantName, strWarehouseName FROM sms.tblSalesReturnHeaderArc WHERE intBusinessUnitId=211 ORDER BY dteReturnDateTime DESC");
    const complaints = compRaw.recordset.map((r,i) => ({
      id: 'CMP-'+String(i+1).padStart(4,'0'), customer: r.customer||'Unknown',
      subject: 'Return: '+(r.strSalesOrderNo||'N/A'),
      description: r.reason||'Sales return, Qty: '+(r.numTotalReturnQty||0),
      priority: (r.numTotalReturnQty>50)?'high':(r.numTotalReturnQty>10?'medium':'low'),
      status: r.isClosed?'resolved':(r.isActive?'open':'in_progress'),
      assigned_to: r.strWarehouseName||r.strPlantName||'Trading Sales', created_at: new Date().toISOString()
    }));
    console.log('Complaints:', complaints.length);

    // 6. Employees
    const empRaw = await sql.query("SELECT e.strEmployeeName as name, d.strDesignation as designation, e.strEmployeeCode as code, e.isActive, sup.strEmployeeName as supervisor, supd.strDesignation as supervisor_role FROM saas.empEmployeeBasicInfoArc e JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc sup ON e.intSupervisorId = sup.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc supd ON sup.intDesignationId = supd.intDesignationId WHERE e.intBusinessUnitId=211 AND e.isActive=1 ORDER BY sup.strEmployeeName, e.strEmployeeName");
    const employees = empRaw.recordset;
    console.log('Employees:', employees.length);

    // Financial data from DataMart
    const pool2 = await new sql.ConnectionPool({
      server: '203.202.241.211', port: 1433, database: 'DataMart',
      user: 'mcp_user', password: 'iAOS@35o997',
      options: { encrypt: false, trustServerCertificate: true }
    }).connect();
    const finRaw = await pool2.request().query("SELECT SUM(CASE WHEN numAmount < 0 THEN ABS(numAmount) ELSE 0 END) as totalRevenue, SUM(CASE WHEN strFSComponentName = 'Cost Of Goods Sold' THEN numAmount ELSE 0 END) as cogs, SUM(numAmount) as netIncome, COUNT(*) as totalTx, COUNT(DISTINCT strSubGLName) as glAccounts, COUNT(DISTINCT strProfitCenterName) as profitCenters FROM [dbo].[tblISTransaction] WHERE intBusinessUnitId = 211");
    const financial = finRaw.recordset[0];
    console.log('Financial:', financial);

    // Save all
    const seed = {
      accounts: [
        { id:'ACC-00001',username:'admin',password:'',name:'System Admin',role:'super_admin',territory:'HQ' },
        { id:'ACC-00002',username:'manager',password:'',name:'Finance Manager',role:'admin',territory:'Dhaka' },
        { id:'ACC-00003',username:'accountant',password:'',name:'Senior Accountant',role:'management',territory:'Dhaka' },
        { id:'ACC-00004',username:'analyst',password:'',name:'Financial Analyst',role:'management',territory:'Dhaka' }
      ],
      customers, leads, opportunities, orders, complaints,
      visits: [
        { id:'VIS-00001',customer:'BuildMart Ltd.',salesperson:'Sohag Hossain',purpose:'Follow-up',visit_type:'sales',outcome:'Positive',visit_date:'2026-08-10',next_visit:'2026-08-17',notes:'' },
        { id:'VIS-00002',customer:'GreenBuild Developers',salesperson:'Sakib Hasan',purpose:'New product intro',visit_type:'sales',outcome:'Interested',visit_date:'2026-08-09',notes:'' },
        { id:'VIS-00003',customer:'Steel Supplier Ltd.',salesperson:'Karim Mia',purpose:'Supplier meeting',visit_type:'purchase',outcome:'Positive',visit_date:'2026-08-09',next_visit:'2026-08-16',notes:'Negotiated 5% discount' },
        { id:'VIS-00004',customer:'Metro Construction',salesperson:'Sakib Hasan',purpose:'Quality inspection',visit_type:'quality_control',outcome:'Pending',visit_date:'2026-08-10',notes:'Samples collected' }
      ],
      employees,
      financial,
      meta: { buCode:'NTL',buId:211,buName:'Nobayon Traders Ltd.',group:'Trading',subGroup:'Non Food',taxRate:25,generated: new Date().toISOString() }
    };

    fs.writeFileSync('seed-real.json', JSON.stringify(seed, null, 2));
    console.log('\nSaved seed-real.json');
    console.log(`Total: ${customers.length} customers, ${leads.length} leads, ${opportunities.length} opps, ${orders.length} orders, ${complaints.length} complaints, ${employees.length} employees`);

    await sql.close();
    await pool2.close();
  } catch(e) { console.log('ERROR:', e.message, e.stack); }
}
main();
