require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== Recipients table columns + constraints ===');
  console.table((await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns WHERE table_name='officer_email_recipients' ORDER BY ordinal_position`)).rows);
  console.table((await pool.query(`
    SELECT conname, contype FROM pg_constraint WHERE conrelid='officer_email_recipients'::regclass`)).rows);

  console.log('\n=== Seeding escrow officers ===');
  await pool.query(`
    INSERT INTO officer_email_recipients (officer_name, email, officer_type, is_active) VALUES
      ('Christine Quintanar','cquintanar@pct.com','escrow',true),
      ('Karla Casco','kcasco@pct.com','escrow',true),
      ('Joseph Gomez','jgomez@pct.com','escrow',true),
      ('Lupe Vidaca','lvidaca@pct.com','escrow',true),
      ('Anna Ballesteros','aballesteros@pct.com','escrow',true),
      ('Analleli Ayala','aayala@pct.com','escrow',false)
    ON CONFLICT (officer_name) DO UPDATE SET email=EXCLUDED.email, officer_type=EXCLUDED.officer_type, is_active=EXCLUDED.is_active
  `);

  console.log('\n=== Verify escrow recipients ===');
  console.table((await pool.query(`
    SELECT officer_name, email, officer_type, is_active FROM officer_email_recipients WHERE officer_type='escrow' ORDER BY officer_name`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
