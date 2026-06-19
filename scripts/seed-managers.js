require('dotenv').config();
const pool = require('../database/pool');

const assignments = [
  ['Angeline Wu', 'Neil Torquato'],
  ['Christy Coffey', 'Neil Torquato'],
  ['Jane Phan', 'Neil Torquato'],
  ['Laurie Briggs', 'Neil Torquato'],
  ['Linda Ruiz', 'Neil Torquato'],
  ['Nicholas Watt', 'Neil Torquato'],
  ['Nini Kerns', 'Neil Torquato'],
  ['Orange County House Account', 'Neil Torquato'],
  ['Richard Bohn', 'Neil Torquato'],
  ['Saeed Ghaffari', 'Neil Torquato'],
  ['Sandra Millar', 'Neil Torquato'],
  ['Neil Torquato', 'Neil Torquato'],
  ['Anthony Zamora', 'Team Meza'],
  ['Chuck Cota', 'Team Meza'],
  ['Corey Velasquez', 'Team Meza'],
  ['David Gomez', 'Team Meza'],
  ['Felicia Pantoja', 'Team Meza'],
  ['Glendale House Account', 'Team Meza'],
  ['Israel Lopez', 'Team Meza'],
  ['Jesse Lopez', 'Team Meza'],
  ['Jorge Mesa', 'Team Meza'],
  ['Justin Nouri', 'Team Meza'],
  ['Kevin Green', 'Team Meza'],
  ['Lopez Team', 'Team Meza'],
  ['Louis Morreale', 'Team Meza'],
  ['Maria Basilio', 'Team Meza'],
  ['Mark Neveu', 'Team Meza'],
  ['Michael Nouri', 'Team Meza'],
  ['Nelson Torres', 'Team Meza'],
  ['Rouanne Garcia', 'Team Meza'],
  ['Simon Wu', 'Team Meza'],
  ['Sonia Flores', 'Team Meza'],
  ['Title Gals', 'Team Meza'],
  ['Title Team', 'Team Meza'],
  ['Team Meza', 'Team Meza'],
  ['Tony Baumgartner', 'Team Meza'],
  ['Ventura House Account', 'Team Meza'],
  ['Veronica Sanchez', 'Team Meza'],
  ["Vito D'Alessandro", 'Team Meza'],
];

(async () => {
  await pool.query(`
    INSERT INTO sales_managers (manager_name, email) VALUES
      ('Neil Torquato', 'neil@pct.com'),
      ('Team Meza', 'teammeza@pct.com')
    ON CONFLICT (manager_name) DO UPDATE SET email = EXCLUDED.email, is_active = true`);

  for (const [rep, mgr] of assignments) {
    await pool.query(
      `INSERT INTO rep_manager_assignments (sales_rep, manager_name) VALUES ($1, $2)
       ON CONFLICT (sales_rep) DO UPDATE SET manager_name = EXCLUDED.manager_name`,
      [rep, mgr]
    );
  }
  console.log('Seeded', assignments.length, 'assignments across 2 managers.\n');

  console.log('=== Step 3a: Assigned reps NOT in order data (must be ZERO) ===');
  const { rows: missing } = await pool.query(`
    SELECT rma.sales_rep, rma.manager_name
    FROM rep_manager_assignments rma
    LEFT JOIN (SELECT DISTINCT sales_rep FROM order_summary) os ON rma.sales_rep = os.sales_rep
    WHERE os.sales_rep IS NULL
    ORDER BY rma.manager_name, rma.sales_rep`);
  console.table(missing);

  console.log('=== Step 3b: Revenue-producing reps with NO manager (uncovered) ===');
  const { rows: unassigned } = await pool.query(`
    SELECT os.sales_rep, ROUND(SUM(os.total_revenue)::numeric, 2) as total_rev
    FROM order_summary os
    LEFT JOIN rep_manager_assignments rma ON os.sales_rep = rma.sales_rep
    WHERE rma.sales_rep IS NULL AND os.sales_rep IS NOT NULL AND os.sales_rep <> ''
    GROUP BY os.sales_rep
    ORDER BY total_rev DESC`);
  console.table(unassigned);

  console.log('=== Step 4: Team totals each manager email should show (MTD latest) ===');
  const { rows: totals } = await pool.query(`
    SELECT rma.manager_name,
      COUNT(DISTINCT rma.sales_rep) as reps_assigned,
      COUNT(os.id) as mtd_orders,
      ROUND(SUM(os.total_revenue)::numeric, 2) as mtd_revenue
    FROM rep_manager_assignments rma
    LEFT JOIN order_summary os ON rma.sales_rep = os.sales_rep
      AND os.fetch_month = (SELECT MAX(fetch_month) FROM order_summary)
    GROUP BY rma.manager_name
    ORDER BY mtd_revenue DESC NULLS LAST`);
  console.table(totals);

  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
