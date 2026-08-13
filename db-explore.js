const sql = require('mssql');

async function main() {
  const config = {
    server: '203.202.241.211', port: 1433, database: 'DWH',
    user: 'mcp_user', password: 'iAOS@35o997',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 60000
  };
  try {
    await sql.connect(config);

    // 1. Check sales orders by sales office (which "salesperson" handles orders)
    const soByOffice = await sql.query(`SELECT strSalesOfficeName, COUNT(*) as order_count, SUM(numTotalOrderValue) as total_value FROM oms.tblSalesOrderHeaderArc WHERE intBusinessUnitId=211 GROUP BY strSalesOfficeName ORDER BY total_value DESC`);
    console.log('ORDERS BY SALES OFFICE:', JSON.stringify(soByOffice.recordset, null, 2));

    // 2. Sales office employee mapping
    const salesOffice = await sql.query(`SELECT TOP 10 * FROM oms.tblSalesOfficeArc WHERE intBusinessUnitId=211`);
    console.log('\nSALES OFFICE:', JSON.stringify(salesOffice.recordset, null, 2));

    // 3. Key employees with designations
    const emps = await sql.query(`SELECT e.strEmployeeName as name, d.strDesignation as designation, e.strEmployeeCode as code, sup.strEmployeeName as supervisor, supd.strDesignation as supervisor_designation, (SELECT COUNT(*) FROM saas.empEmployeeBasicInfoArc sub WHERE sub.intSupervisorId = e.intEmployeeBasicInfoId AND sub.isActive=1) as team_size FROM saas.empEmployeeBasicInfoArc e JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc sup ON e.intSupervisorId = sup.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc supd ON sup.intDesignationId = supd.intDesignationId WHERE e.intBusinessUnitId=211 AND e.isActive=1 AND (d.strDesignation IN ('Chief Business Officer','Senior Manager','Deputy Manager','Assistant Manager')) ORDER BY CASE d.strDesignation WHEN 'Chief Business Officer' THEN 1 WHEN 'Senior Manager' THEN 2 WHEN 'Deputy Manager' THEN 3 WHEN 'Assistant Manager' THEN 4 END, e.strEmployeeName`);
    console.log('\nKEY EMPLOYEES:', JSON.stringify(emps.recordset, null, 2));

    // 4. Customer visit plans (visits data)
    try {
      const visits = await sql.query(`SELECT COUNT(*) as cnt FROM oms.tblCustomerVisitPlanActualArc WHERE intBusinessUnitId=211`);
      console.log('\nVISIT PLANS:', visits.recordset[0]);
    } catch(e) { console.log('Visits error:', e.message); }

    // 5. Sales targets for these employees
    try {
      const targets = await sql.query(`SELECT * FROM oms.tblCustomerSalesTargetHeaderArc WHERE intBusinessUnitId=211`);
      console.log('\nTARGETS columns:', Object.keys(targets.recordset[0]||{}).join(', '));
      console.log('TARGETS sample:', JSON.stringify(targets.recordset.slice(0,5), null, 2));
    } catch(e) { console.log('Targets error:', e.message); }

    await sql.close();
  } catch(e) { console.log('ERROR:', e.message); }
}
main();
