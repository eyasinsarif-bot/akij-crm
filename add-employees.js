const sql = require('mssql');
const fs = require('fs');

async function main() {
  const config = {
    server: '203.202.241.211', port: 1433, database: 'DWH',
    user: 'mcp_user', password: 'iAOS@35o997',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 30000
  };
  try {
    await sql.connect(config);
    const r = await sql.query(`SELECT e.strEmployeeName as name, d.strDesignation as designation, e.strEmployeeCode as code, e.isActive, sup.strEmployeeName as supervisor, supd.strDesignation as supervisor_role, lm.strEmployeeName as line_manager, lmd.strDesignation as lm_role FROM saas.empEmployeeBasicInfoArc e JOIN saas.masterDesignationArc d ON e.intDesignationId = d.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc sup ON e.intSupervisorId = sup.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc supd ON sup.intDesignationId = supd.intDesignationId LEFT JOIN saas.empEmployeeBasicInfoArc lm ON e.intLineManagerId = lm.intEmployeeBasicInfoId LEFT JOIN saas.masterDesignationArc lmd ON lm.intDesignationId = lmd.intDesignationId WHERE e.intBusinessUnitId=211 AND e.isActive=1 ORDER BY sup.strEmployeeName, e.strEmployeeName`);
    
    let s = JSON.parse(fs.readFileSync('seed-real.json', 'utf8'));
    s.employees = r.recordset;
    fs.writeFileSync('seed-real.json', JSON.stringify(s, null, 2));
    fs.copyFileSync('seed-real.json', 'data/seed-real.json');
    console.log('Employees added:', r.recordset.length);
    await sql.close();
  } catch(e) { console.log('ERROR:', e.message); }
}
main();
