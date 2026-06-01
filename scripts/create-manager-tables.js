require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_managers (
      id SERIAL PRIMARY KEY,
      manager_name VARCHAR(150) NOT NULL UNIQUE,
      email VARCHAR(200) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rep_manager_assignments (
      id SERIAL PRIMARY KEY,
      sales_rep VARCHAR(150) NOT NULL UNIQUE,
      manager_name VARCHAR(150) NOT NULL REFERENCES sales_managers(manager_name),
      created_at TIMESTAMP DEFAULT NOW()
    )`);

  const { rows: mgr } = await pool.query('SELECT COUNT(*)::int AS n FROM sales_managers');
  const { rows: asg } = await pool.query('SELECT COUNT(*)::int AS n FROM rep_manager_assignments');
  console.log('sales_managers rows:', mgr[0].n);
  console.log('rep_manager_assignments rows:', asg[0].n);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
