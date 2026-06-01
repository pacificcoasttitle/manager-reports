require('dotenv').config();
const pool = require('../database/pool');

// [sales_rep, email]  — reps without an email are intentionally omitted (stay NULL, won't receive)
const repEmails = [
  // Neil Torquato's team
  ['Angeline Wu', 'aahn@angelineahn.com'],
  ['Christy Coffey', 'ccoffey@pct.com'],
  ['Jane Phan', 'jphan@pct.com'],
  ['Laurie Briggs', 'lbriggs@pct.com'],
  ['Linda Ruiz', 'lruiz@pct.com'],
  ['Nicholas Watt', 'nick@joinnickwatt.com'],
  ['Nini Kerns', 'nkerns@pct.com'],
  ['Richard Bohn', 'rbohn@pct.com'],
  ['Saeed Ghaffari', 'sghaffari@pct.com'],
  ['Sandra Millar', 'smillar@pct.com'],
  ['Neil Torquato', 'neil@pct.com'],
  // Team Meza's team
  ['Anthony Zamora', 'azamora@pct.com'],
  ['Chuck Cota', 'ccota@pct.com'],
  ['Corey Velasquez', 'cvelasquez@pct.com'],
  ['David Gomez', 'dgomez@pct.com'],
  ['Felicia Pantoja', 'fpantoja@pct.com'],
  ['Israel Lopez', 'ilopez@pct.com'],
  ['Jesse Lopez', 'jlopez@pct.com'],
  ['Jorge Mesa', 'jmesa@pct.com'],
  ['Justin Nouri', 'jnouri@pct.com'],
  ['Kevin Green', 'kgreen@pct.com'],
  ['Lopez Team', 'Teamlopez@pct.com'],
  ['Louis Morreale', 'lmorreale@pct.com'],
  ['Maria Basilio', 'mbasilio@pct.com'],
  ['Mark Neveu', 'mneveu@pct.com'],
  ['Michael Nouri', 'mnouri@pct.com'],
  ['Nelson Torres', 'ntorres@pct.com'],
  ['Rouanne Garcia', 'rgarcia@pct.com'],
  ['Simon Wu', 'swu@pct.com'],
  ['Sonia Flores', 'sflores@pct.com'],
  ['Title Gals', 'titlegals@pct.com'],
  ['Title Team', 'titleteam@pct.com'],
  ['Team Meza', 'teammeza@pct.com'],
  ['Tony Baumgartner', 'tbaumgartner@pct.com'],
  ['Ventura House Account', 'ventura1@pct.com'],
  ['Veronica Sanchez', 'vsanchez@pct.com'],
  ["Vito D'Alessandro", 'vdalessandro@pct.com'],
];

(async () => {
  // Step 1: schema
  await pool.query("ALTER TABLE rep_manager_assignments ADD COLUMN IF NOT EXISTS email VARCHAR(200)");
  await pool.query("ALTER TABLE rep_manager_assignments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true");
  console.log('Schema OK: email + is_active columns present.');

  // Step 2: seed
  let updated = 0, missing = [];
  for (const [rep, email] of repEmails) {
    const r = await pool.query('UPDATE rep_manager_assignments SET email = $1 WHERE sales_rep = $2', [email, rep]);
    if (r.rowCount === 0) missing.push(rep);
    else updated += r.rowCount;
  }
  console.log(`Seeded emails: ${updated} rows updated.`);
  if (missing.length) console.log('WARNING — these reps were not found in rep_manager_assignments:', missing);

  // Verify
  const { rows } = await pool.query(
    "SELECT sales_rep, manager_name, email, is_active FROM rep_manager_assignments ORDER BY (email IS NULL), manager_name, sales_rep"
  );
  console.log(`\nAll ${rows.length} assignments:`);
  console.table(rows);

  const withEmail = rows.filter(r => r.email).length;
  const noEmail = rows.filter(r => !r.email).map(r => r.sales_rep);
  console.log(`\nWith email (will receive): ${withEmail}`);
  console.log('No email (won\'t receive):', noEmail.join(', ') || 'none');

  await pool.end();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
