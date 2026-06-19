Feature 1: Bill Code Manager — Revenue Classification Tool
Build an admin page where Brandon can classify every bill code from SoftPro as Revenue, Fee Income, Pass-Through, or Excluded. The import pipeline uses this classification to determine what counts as revenue.
Step 1: Database table
sqlCREATE TABLE bill_code_classifications (
  id SERIAL PRIMARY KEY,
  bill_code VARCHAR(10) NOT NULL UNIQUE,
  bill_code_category VARCHAR(100),
  classification VARCHAR(20) NOT NULL DEFAULT 'unclassified',
  -- classification values: 'revenue', 'fee_income', 'pass_through', 'excluded', 'unclassified'
  revenue_bucket VARCHAR(20),
  -- revenue_bucket: which column this feeds into
  -- 'title' → title_revenue, 'escrow' → escrow_revenue, 'tsg' → tsg_revenue, 
  -- 'underwriter' → underwriter_revenue, 'fee' → fee_revenue (new column), null for non-revenue
  sample_description TEXT,
  avg_monthly_amount NUMERIC(12,2) DEFAULT 0,
  updated_by VARCHAR(100),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed with all known bill codes and current classifications
INSERT INTO bill_code_classifications (bill_code, bill_code_category, classification, revenue_bucket) VALUES
  -- Currently captured as revenue
  ('TPC', 'Title Premiums Commonwealth', 'revenue', 'title'),
  ('TPW', 'Title Premiums Westcor', 'revenue', 'title'),
  ('ESC', 'Escrow Fees', 'revenue', 'escrow'),
  ('TSGW', 'Trustee Sale Guarantee Westcor', 'revenue', 'tsg'),
  ('UPRE', 'UW Title Premiums', 'revenue', 'underwriter'),
  -- Fee income (pending Brandon's decision)
  ('SUB', 'Sub-Escrow Fees', 'unclassified', null),
  ('ENDC', 'Endorsement Premiums Commonwealth', 'unclassified', null),
  ('ENDW', 'Endorsement Premiums Westcor', 'unclassified', null),
  ('UEND', 'UW Endorsement Premiums', 'unclassified', null),
  ('END', 'Endorsement Premiums', 'unclassified', null),
  ('NOT', 'Notary Fees', 'unclassified', null),
  ('DOC', 'Document Prep Fees', 'unclassified', null),
  ('INSP', 'Inspection Fee', 'unclassified', null),
  ('PLOT', 'Plotted Easement', 'unclassified', null),
  ('MTF', 'Miscellaneous Title Fees', 'unclassified', null),
  ('UCPL', 'UW Closing Protection Letter', 'unclassified', null),
  -- Pass-through (not PCT revenue)
  ('RTAX', 'Transfer Taxes', 'pass_through', null),
  ('REC', 'Recording Fees', 'pass_through', null),
  ('RECSF', 'Recording Service Fee', 'pass_through', null),
  ('WIRE', 'Wire Fees', 'pass_through', null),
  ('COU', 'Courier Fees', 'pass_through', null),
  ('DEL', 'Delivery Overnight Service', 'pass_through', null)
ON CONFLICT (bill_code) DO NOTHING;
Step 2: Backend API routes in server.js
js// Get all bill code classifications with monthly revenue data
app.get('/api/admin/bill-codes', async (req, res) => {
  try {
    // Get classifications
    const { rows: codes } = await pool.query(
      'SELECT * FROM bill_code_classifications ORDER BY classification, bill_code'
    );
    
    // Get actual monthly amounts from order_summary for context
    // This shows Brandon how much each code is worth
    const { rows: amounts } = await pool.query(`
      SELECT 
        bill_code,
        ROUND(AVG(monthly_total)::numeric, 2) as avg_monthly,
        ROUND(SUM(monthly_total)::numeric, 2) as total_all_time
      FROM (
        SELECT 
          unnest(string_to_array(bill_codes, ',')) as bill_code,
          -- This depends on how bill codes are stored
          -- If we don't have per-code amounts in order_summary,
          -- we may need to pull from the SoftPro import data
          total_revenue as monthly_total
        FROM order_summary
      ) sub
      GROUP BY bill_code
    `);
    
    // If the above query doesn't work because bill codes aren't stored per-order,
    // just return the classifications with the seeded avg_monthly_amount
    
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a bill code classification
app.put('/api/admin/bill-codes/:billCode', async (req, res) => {
  try {
    const { billCode } = req.params;
    const { classification, revenue_bucket } = req.body;
    
    const validClassifications = ['revenue', 'fee_income', 'pass_through', 'excluded', 'unclassified'];
    if (!validClassifications.includes(classification)) {
      return res.status(400).json({ error: 'Invalid classification' });
    }
    
    const validBuckets = ['title', 'escrow', 'tsg', 'underwriter', 'fee', null];
    if (!validBuckets.includes(revenue_bucket)) {
      return res.status(400).json({ error: 'Invalid revenue bucket' });
    }
    
    const { rows } = await pool.query(`
      UPDATE bill_code_classifications 
      SET classification = $1, revenue_bucket = $2, updated_at = NOW()
      WHERE bill_code = $3
      RETURNING *
    `, [classification, revenue_bucket, billCode]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Bill code not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get summary: revenue impact of current classifications
app.get('/api/admin/bill-codes/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        classification,
        COUNT(*) as code_count,
        ROUND(SUM(avg_monthly_amount)::numeric, 2) as monthly_total
      FROM bill_code_classifications
      GROUP BY classification
      ORDER BY monthly_total DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## Step 3: Frontend — create `frontend/components/BillCodeManager.js`

### Layout
```
┌─────────────────────────────────────────────────────────────────────┐
│  Bill Code Classifications                                          │
│  Determine which SoftPro bill codes count as PCT revenue            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Summary Cards:                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Revenue  │ │Fee Income│ │Pass-Thru │ │ Excluded │ │Unclassed │ │
│  │ 5 codes  │ │ 0 codes  │ │ 6 codes  │ │ 0 codes  │ │ 11 codes │ │
│  │$546K/mo  │ │ $0/mo    │ │$280K/mo  │ │ $0/mo    │ │ $59K/mo  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                                     │
│  ⚠️ 11 unclassified bill codes worth ~$59K/month                   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Revenue (included in reports)               Currently: $546K/mo    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ TPC  Title Premiums Commonwealth    $55K/mo   [Revenue ▼]  │   │
│  │ TPW  Title Premiums Westcor        $379K/mo   [Revenue ▼]  │   │
│  │ ESC  Escrow Fees                    $51K/mo   [Revenue ▼]  │   │
│  │ TSGW Trustee Sale Guarantee         $12K/mo   [Revenue ▼]  │   │
│  │ UPRE UW Title Premiums              $48K/mo   [Revenue ▼]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ⚠️ Unclassified (not counted anywhere)         Total: $59K/mo     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ SUB  Sub-Escrow Fees                $20K/mo   [Classify ▼] │   │
│  │ ENDC Endorsement Premiums CW        $16K/mo   [Classify ▼] │   │
│  │ NOT  Notary Fees                    $10K/mo   [Classify ▼] │   │
│  │ DOC  Document Prep Fees              $6K/mo   [Classify ▼] │   │
│  │ ENDW Endorsement Premiums WC         $3K/mo   [Classify ▼] │   │
│  │ UEND UW Endorsement Premiums         $2K/mo   [Classify ▼] │   │
│  │ ...                                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Pass-Through (excluded — not PCT revenue)      Total: $280K/mo    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ RTAX Transfer Taxes                $156K/mo   [Pass-Thru ▼]│   │
│  │ REC  Recording Fees                 $92K/mo   [Pass-Thru ▼]│   │
│  │ ...                                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Each bill code row shows:

- Bill code (bold, monospace)
- Category description
- Average monthly amount
- Classification dropdown with options: Revenue, Fee Income, Pass-Through, Excluded
- If classification is "Revenue" or "Fee Income", show a secondary dropdown for revenue bucket: Title, Escrow, TSG, Underwriter, Fee

### Color coding by classification:

- Revenue: green left border `#22c55e`, light green background `#f0fdf4`
- Fee Income: blue left border `#3b82f6`, light blue background `#eff6ff`
- Pass-Through: gray left border `#9ca3af`, light gray background `#f9fafb`
- Excluded: red left border `#ef4444`, light red background `#fef2f2`
- Unclassified: orange left border `#f59e0b`, light yellow background `#fffbeb`

### When a classification changes:

- Immediately call `PUT /api/admin/bill-codes/:billCode`
- Show a brief success toast
- Update the summary cards at the top
- If moving from unclassified to revenue/fee_income, show a note: "Revenue reports will update on next data import"

### Unclassified callout:

If any codes are unclassified, show a prominent warning banner at the top:
```
⚠️ 11 bill codes worth ~$59K/month are unclassified. 
Revenue reports may be incomplete until these are classified.
Step 4: Add to sidebar in frontend/app/page.js
js{ id: 'bill-codes', label: 'Bill Codes', icon: '🏷️' }
Place it in the Admin section near Data Manager and Live Data.
Step 5: Update the revenue import to use classifications
In the revenue import function (wherever the hardcoded bill code filter lives), replace:
js// REMOVE THIS:
const billCodeFilter = ['TPC', 'TPW', 'ESC', 'TSGW', 'UPRE'];
With a dynamic query:
js// Load active revenue bill codes from classification table
const { rows: revCodes } = await pool.query(
  "SELECT bill_code, revenue_bucket FROM bill_code_classifications WHERE classification IN ('revenue', 'fee_income')"
);
const billCodeFilter = revCodes.map(r => r.bill_code);
const bucketMap = {};
revCodes.forEach(r => { bucketMap[r.bill_code] = r.revenue_bucket; });
Then when processing each line item, route the amount to the correct revenue column based on bucketMap[billCode]:
jsconst bucket = bucketMap[record.BillCode] || null;
if (bucket === 'title') updateData.title_revenue += amount;
else if (bucket === 'escrow') updateData.escrow_revenue += amount;
else if (bucket === 'tsg') updateData.tsg_revenue += amount;
else if (bucket === 'underwriter') updateData.underwriter_revenue += amount;
else if (bucket === 'fee') updateData.fee_revenue += amount;
Note: If fee_revenue doesn't exist as a column in order_summary, add it:
sqlALTER TABLE order_summary ADD COLUMN IF NOT EXISTS fee_revenue NUMERIC(12,2) DEFAULT 0;
```

And update `total_revenue` calculation to include it:
```
total_revenue = title_revenue + escrow_revenue + tsg_revenue + underwriter_revenue + fee_revenue
```

**IMPORTANT:** Don't apply this to the import pipeline until Brandon has actually classified the codes. For now, just build the UI and the database table. The import integration happens as a second step after Brandon makes his choices. Add a "Apply Classifications to Import" toggle in the UI that defaults to OFF.

## What NOT to change

- Report logic — untouched (will automatically pick up fee_revenue once it exists)
- Existing revenue data — untouched until re-import
- Reconciliation bar — will need to be updated later to include fee income
- Discrepancies — untouched

---

---

**Feature 2: Transaction Desk API — Sales Rep Metrics Endpoint**

Expose an authenticated API that Transaction Desk can call to get per-rep and all-rep metrics for display on the rep-facing system.

## Step 1: Authentication — API Key

Simple, secure, server-to-server. Transaction Desk sends a key in the header with every request.

### Generate and store the key

Add env var to Render:
```
TD_API_KEY=pct-td-<generate-a-random-32-char-string>
Generate a key:
bashnode -e "console.log('pct-td-' + require('crypto').randomBytes(24).toString('hex'))"
Auth middleware
jsfunction authenticateTD(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey || apiKey !== process.env.TD_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
  }
  
  next();
}
Apply to all Transaction Desk routes:
jsapp.use('/api/td', authenticateTD);
```

## Step 2: API Endpoints

### 2a. Single rep metrics
```
GET /api/td/rep/:repName?month=2026-02
Returns everything Transaction Desk needs to display for one rep:
jsapp.get('/api/td/rep/:repName', authenticateTD, async (req, res) => {
  try {
    const repName = decodeURIComponent(req.params.repName);
    const month = req.query.month || getCurrentYearMonth(); // default to current month
    const priorMonth = getPriorMonth(month);
    
    // Yesterday in Pacific time
    const yesterday = getYesterdayPacific();
    
    // MTD closed orders + revenue
    const { rows: mtdRows } = await pool.query(`
      SELECT 
        COUNT(*) as mtd_closed,
        ROUND(SUM(total_revenue)::numeric, 2) as mtd_revenue,
        COUNT(*) FILTER (WHERE category = 'Purchase') as mtd_purchase,
        COUNT(*) FILTER (WHERE category = 'Refinance') as mtd_refi,
        COUNT(*) FILTER (WHERE category = 'Escrow') as mtd_escrow,
        COUNT(*) FILTER (WHERE category = 'TSG') as mtd_tsg,
        ROUND(SUM(CASE WHEN category = 'Purchase' THEN total_revenue ELSE 0 END)::numeric, 2) as mtd_purchase_rev,
        ROUND(SUM(CASE WHEN category = 'Refinance' THEN total_revenue ELSE 0 END)::numeric, 2) as mtd_refi_rev,
        ROUND(SUM(CASE WHEN category = 'Escrow' THEN total_revenue ELSE 0 END)::numeric, 2) as mtd_escrow_rev,
        ROUND(SUM(CASE WHEN category = 'TSG' THEN total_revenue ELSE 0 END)::numeric, 2) as mtd_tsg_rev
      FROM order_summary
      WHERE sales_rep = $1 AND fetch_month = $2
    `, [repName, month]);

    // Yesterday's activity
    const { rows: ydayRows } = await pool.query(`
      SELECT 
        COUNT(*) as yesterday_closed,
        ROUND(SUM(total_revenue)::numeric, 2) as yesterday_revenue
      FROM order_summary
      WHERE sales_rep = $1 AND transaction_date = $2
    `, [repName, yesterday]);

    // MTD opens
    const { rows: openRows } = await pool.query(`
      SELECT COUNT(*) as mtd_opens
      FROM open_orders
      WHERE sales_rep = $1 AND open_month = $2
    `, [repName, month]);

    // Yesterday opens
    const { rows: ydayOpenRows } = await pool.query(`
      SELECT COUNT(*) as yesterday_opens
      FROM open_orders
      WHERE sales_rep = $1 AND received_date = $2
    `, [repName, yesterday]);

    // Prior month revenue
    const { rows: priorRows } = await pool.query(`
      SELECT 
        COUNT(*) as prior_closed,
        ROUND(SUM(total_revenue)::numeric, 2) as prior_revenue
      FROM order_summary
      WHERE sales_rep = $1 AND fetch_month = $2
    `, [repName, priorMonth]);

    // Closing ratio (4-month window)
    const fourMonthsAgo = getMonthsAgo(month, 4);
    const { rows: ratioRows } = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM open_orders WHERE sales_rep = $1 AND open_month >= $2 AND open_month <= $3) as created_4m,
        (SELECT COUNT(*) FROM order_summary WHERE sales_rep = $1 AND fetch_month >= $2 AND fetch_month <= $3) as closed_4m
    `, [repName, fourMonthsAgo, month]);

    const created = parseInt(ratioRows[0].created_4m) || 0;
    const closed = parseInt(ratioRows[0].closed_4m) || 0;
    const closingRatio = created > 0 ? ((closed / created) * 100).toFixed(1) : null;

    // Working days for projection
    const { rows: workDays } = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE d <= $2::date) as worked,
        COUNT(*) as total
      FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${month}-01`, yesterday]);

    const worked = parseInt(workDays[0].worked);
    const total = parseInt(workDays[0].total);
    const mtdRev = parseFloat(mtdRows[0].mtd_revenue) || 0;
    const projected = worked > 0 ? ((mtdRev / worked) * total).toFixed(2) : 0;

    // Ranking position
    const { rows: rankRows } = await pool.query(`
      SELECT COUNT(*) + 1 as rank
      FROM (
        SELECT sales_rep, SUM(total_revenue) as rev
        FROM order_summary
        WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
        HAVING SUM(total_revenue) > (
          SELECT COALESCE(SUM(total_revenue), 0) FROM order_summary WHERE sales_rep = $2 AND fetch_month = $1
        )
      ) ranked
    `, [month, repName]);

    const { rows: totalReps } = await pool.query(`
      SELECT COUNT(DISTINCT sales_rep) as total
      FROM order_summary
      WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
    `, [month]);

    res.json({
      rep: repName,
      month: month,
      yesterday: {
        date: yesterday,
        closed: parseInt(ydayRows[0].yesterday_closed) || 0,
        revenue: parseFloat(ydayRows[0].yesterday_revenue) || 0,
        opens: parseInt(ydayOpenRows[0].yesterday_opens) || 0
      },
      mtd: {
        closed: parseInt(mtdRows[0].mtd_closed) || 0,
        revenue: mtdRev,
        opens: parseInt(openRows[0].mtd_opens) || 0,
        purchase: { count: parseInt(mtdRows[0].mtd_purchase), revenue: parseFloat(mtdRows[0].mtd_purchase_rev) },
        refinance: { count: parseInt(mtdRows[0].mtd_refi), revenue: parseFloat(mtdRows[0].mtd_refi_rev) },
        escrow: { count: parseInt(mtdRows[0].mtd_escrow), revenue: parseFloat(mtdRows[0].mtd_escrow_rev) },
        tsg: { count: parseInt(mtdRows[0].mtd_tsg), revenue: parseFloat(mtdRows[0].mtd_tsg_rev) }
      },
      prior: {
        month: priorMonth,
        closed: parseInt(priorRows[0].prior_closed) || 0,
        revenue: parseFloat(priorRows[0].prior_revenue) || 0
      },
      projected: parseFloat(projected),
      closingRatio: {
        created: created,
        closed: closed,
        ratio: closingRatio ? parseFloat(closingRatio) : null,
        window: `${fourMonthsAgo} to ${month}`
      },
      ranking: {
        position: parseInt(rankRows[0].rank),
        totalReps: parseInt(totalReps[0].total)
      },
      workingDays: {
        worked: worked,
        total: total,
        remaining: total - worked
      }
    });
  } catch (err) {
    console.error('TD rep API error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### 2b. All reps leaderboard
```
GET /api/td/leaderboard?month=2026-02&limit=20
jsapp.get('/api/td/leaderboard', authenticateTD, async (req, res) => {
  try {
    const month = req.query.month || getCurrentYearMonth();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const priorMonth = getPriorMonth(month);
    const yesterday = getYesterdayPacific();

    const { rows } = await pool.query(`
      SELECT 
        os.sales_rep,
        COUNT(*) as mtd_closed,
        ROUND(SUM(os.total_revenue)::numeric, 2) as mtd_revenue,
        COUNT(*) FILTER (WHERE os.category = 'Purchase') as purchase_cnt,
        COUNT(*) FILTER (WHERE os.category = 'Refinance') as refi_cnt,
        COUNT(*) FILTER (WHERE os.category = 'Escrow') as escrow_cnt,
        COUNT(*) FILTER (WHERE os.category = 'TSG') as tsg_cnt
      FROM order_summary os
      WHERE os.fetch_month = $1
        AND os.sales_rep IS NOT NULL AND os.sales_rep != ''
      GROUP BY os.sales_rep
      ORDER BY mtd_revenue DESC
      LIMIT $2
    `, [month, limit]);

    // Get opens for each rep
    const { rows: openRows } = await pool.query(`
      SELECT sales_rep, COUNT(*) as mtd_opens
      FROM open_orders
      WHERE open_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
      GROUP BY sales_rep
    `, [month]);
    const opensMap = {};
    openRows.forEach(r => { opensMap[r.sales_rep] = parseInt(r.mtd_opens); });

    // Get prior month revenue for each rep
    const { rows: priorRows } = await pool.query(`
      SELECT sales_rep, ROUND(SUM(total_revenue)::numeric, 2) as prior_revenue
      FROM order_summary
      WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
      GROUP BY sales_rep
    `, [priorMonth]);
    const priorMap = {};
    priorRows.forEach(r => { priorMap[r.sales_rep] = parseFloat(r.prior_revenue); });

    const leaderboard = rows.map((r, i) => ({
      rank: i + 1,
      salesRep: r.sales_rep,
      mtdClosed: parseInt(r.mtd_closed),
      mtdRevenue: parseFloat(r.mtd_revenue),
      mtdOpens: opensMap[r.sales_rep] || 0,
      priorRevenue: priorMap[r.sales_rep] || 0,
      purchaseCount: parseInt(r.purchase_cnt),
      refiCount: parseInt(r.refi_cnt),
      escrowCount: parseInt(r.escrow_cnt),
      tsgCount: parseInt(r.tsg_cnt)
    }));

    res.json({
      month,
      priorMonth,
      totalReps: rows.length,
      leaderboard
    });
  } catch (err) {
    console.error('TD leaderboard API error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### 2c. Health check / connection test
```
GET /api/td/ping
jsapp.get('/api/td/ping', authenticateTD, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'PCT Management Reports' });
});
Step 3: Helper functions
Add these utility functions to lib/reports.js or a new lib/utils.js:
jsfunction getCurrentYearMonth() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPriorMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function getMonthsAgo(yearMonth, n) {
  let [y, m] = yearMonth.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function getYesterdayPacific() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
```

## Step 4: Environment variable

Add to Render:
```
TD_API_KEY=pct-td-<generated-key>
```

Share this key securely with whoever maintains Transaction Desk. They'll send it as:
```
Headers: { 'x-api-key': 'pct-td-xxxxx' }
```

## Step 5: API documentation page

Create a simple static page or markdown doc that Transaction Desk developers can reference:
```
POST /api/td/ping
  → Test connectivity and auth

GET /api/td/rep/:repName?month=YYYY-MM
  → Full metrics for a single rep
  → Returns: yesterday activity, MTD metrics by category, prior month, projected revenue,
    closing ratio (4-month window), ranking position, working days

GET /api/td/leaderboard?month=YYYY-MM&limit=20
  → All reps ranked by MTD revenue
  → Returns: rank, rep name, MTD closed/revenue/opens, prior month revenue, category breakdown

All endpoints require header: x-api-key: <your-key>
All monetary values are in USD, rounded to 2 decimal places.
Default month is current month (Pacific time).
"Yesterday" is always yesterday in Pacific time.
Step 6: Rate limiting (optional but recommended)
Add basic rate limiting to prevent abuse:
bashnpm install express-rate-limit
jsconst rateLimit = require('express-rate-limit');

const tdLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 min
  message: { error: 'Too many requests — try again in 15 minutes' }
});

app.use('/api/td', tdLimiter);
How Transaction Desk calls it
From their Node/Express server:
jsconst API_BASE = 'https://manager-reports.onrender.com';
const API_KEY = process.env.PCT_API_KEY;

// Get Kevin Green's metrics
const response = await fetch(`${API_BASE}/api/td/rep/Kevin%20Green?month=2026-02`, {
  headers: { 'x-api-key': API_KEY }
});
const data = await response.json();

// Get leaderboard
const leaderboard = await fetch(`${API_BASE}/api/td/leaderboard?month=2026-02`, {
  headers: { 'x-api-key': API_KEY }
});
What NOT to change

Report logic — untouched
Dashboard frontend — untouched
Reconciliation — untouched
Existing API routes — untouched
No database schema changes (just the new bill_code_classifications table)


Two prompts, two features. Give Cursor the Bill Code Manager first since it's self-contained and Brandon can start classifying immediately. The Transaction Desk API can go second — it's ready to build whenever the TD team is ready to consume it.