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

    // Designations for BU 211 employees
    const desig = await sql.query(`
      SELECT d.strDesignation, COUNT(*) as cnt 
      FROM saas.empEmployeeBasicInfoArc e 
      JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId 
      WHERE e.intBusinessUnitId = 211 
      GROUP BY d.strDesignation ORDER BY cnt DESC
    `);
    console.log('DESIGNATIONS:', JSON.stringify(desig.recordset, null, 2));

    // All active employees with designation
    const emps = await sql.query(`
      SELECT e.strEmployeeName, d.strDesignation, e.strEmployeeCode, e.intSupervisorId, e.intLineManagerId, e.isActive
      FROM saas.empEmployeeBasicInfoArc e 
      JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId 
      WHERE e.intBusinessUnitId = 211 AND e.isActive = 1
      ORDER BY d.strDesignation, e.strEmployeeName
    `);
    console.log('\nACTIVE EMPLOYEES (' + emps.recordset.length + '):');
    emps.recordset.forEach(e => console.log('  ' + e.strEmployeeName + ' | ' + e.strDesignation));

    // Get supervisor names via self-join
    const sups = await sql.query(`
      SELECT DISTINCT e2.strEmployeeName as supervisor_name, d2.strDesignation as supervisor_designation
      FROM saas.empEmployeeBasicInfoArc e1
      JOIN saas.empEmployeeBasicInfoArc e2 ON e1.intSupervisorId = e2.intEmployeeBasicInfoId
      JOIN saas.masterDesignationArc d2 ON e2.intDesignationId = d2.intDesignationId
      WHERE e1.intBusinessUnitId = 211
    `);
    console.log('\nSUPERVISORS:', JSON.stringify(sups.recordset, null, 2));

    // Employee with supervisor info
    const full = await sql.query(`
      SELECT e.strEmployeeName as name, d.strDesignation as designation, e.strEmployeeCode as code, e.isActive,
        sup.strEmployeeName as supervisor_name, supd.strDesignation as supervisor_designation,
        lm.strEmployeeName as line_manager, lmd.strDesignation as lm_designation
      FROM saas.empEmployeeBasicInfoArc e 
      JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId 
      LEFT JOIN saas.empEmployeeBasicInfoArc sup ON e.intSupervisorId = sup.intEmployeeBasicInfoId
      LEFT JOIN saas.masterDesignationArc supd ON sup.intDesignationId = supd.intDesignationId
      LEFT JOIN saas.empEmployeeBasicInfoArc lm ON e.intLineManagerId = lm.intEmployeeBasicInfoId
      LEFT JOIN saas.masterDesignationArc lmd ON lm.intDesignationId = lmd.intDesignationId
      WHERE e.intBusinessUnitId = 211 AND e.isActive = 1
      ORDER BY sup.strEmployeeName, e.strEmployeeName
    `);
    console.log('\nFULL DATA (' + full.recordset.length + '):');
    console.log(JSON.stringify(full.recordset, null, 2));

    await sql.close();
  } catch(e) { console.log('ERROR:', e.message); }
}
main();
