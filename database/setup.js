const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function setup() {
  console.log('Setting up database...');
  
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Schema created successfully.');
    
    // Verify tables
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('Tables:', result.rows.map(r => r.table_name));
    
  } catch (err) {
    console.error('Schema setup failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setup();
