/**
 * Adds the effective_start_date mechanism and seeds Richard Dickerson as a title
 * officer with a 2026-07-09 effective start. The column is nullable and defaults
 * to NULL, so it is a no-op for every existing officer (their emails are unchanged).
 * Also maps Richard to Glendale in title_officer_branches (data: 100% GLT) so the
 * Title Officer / Title Revenue reports move his production out of "Unassigned".
 */
const pool = require('../database/pool');
(async () => {
  console.log('PART 1: add effective_start_date column (nullable, no-op for everyone)');
  await pool.query(`ALTER TABLE officer_email_recipients ADD COLUMN IF NOT EXISTS effective_start_date DATE DEFAULT NULL`);

  console.log('PART 2: seed Richard Dickerson (title, effective 2026-07-09)');
  await pool.query(`
    INSERT INTO officer_email_recipients (officer_name, email, officer_type, is_active, effective_start_date)
    VALUES ('Richard Dickerson', 'rdickerson@pct.com', 'title', true, '2026-07-09')
    ON CONFLICT (officer_name) DO UPDATE
      SET email = EXCLUDED.email, officer_type = EXCLUDED.officer_type,
          is_active = EXCLUDED.is_active, effective_start_date = EXCLUDED.effective_start_date`);

  console.log('\nActive title officers (effective_start_date should be NULL for all but Richard):');
  console.table((await pool.query(`
    SELECT officer_name, email, officer_type, is_active, effective_start_date
    FROM officer_email_recipients WHERE officer_type = 'title' ORDER BY officer_name`)).rows);

  console.log('\nPART 4: map Richard -> Glendale in title_officer_branches (reports fix)');
  // Only touch title_officer_branches if it exists; don't fail the seed if it doesn't.
  const { rows: tbl } = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='title_officer_branches'`);
  if (tbl.length) {
    await pool.query(`
      INSERT INTO title_officer_branches (officer_name, branch, is_active)
      VALUES ('Richard Dickerson', 'Glendale', true)
      ON CONFLICT (officer_name) DO UPDATE SET branch = 'Glendale', is_active = true`);
    console.table((await pool.query(`SELECT officer_name, branch, is_active FROM title_officer_branches WHERE officer_name='Richard Dickerson'`)).rows);
  } else {
    console.log('  title_officer_branches table not found — skipping branch map (flag to user).');
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
