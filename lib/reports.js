const pool = require('../database/pool');
const { getDateParams, categorizeOrder, categorizeForTitleOfficer, categorizeForEscrow, getBranch } = require('./business-logic');

// ============================================
// REPORT 1: DAILY REVENUE (Branch Analytics)
// ============================================
// Shows open orders, closed orders, and revenue by branch and order type
// Periods: Today (yesterday), MTD, Prior Month

async function dailyRevenue(month, year) {
  const dates = getDateParams(month, year);
  
  // Get current month orders
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1); // month is 1-indexed
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Fetch closed orders from order_summary
  const { rows: currentOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1',
    [currentMonth]
  );
  
  const { rows: priorOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1',
    [priorMonth]
  );
  
  // Fetch open order counts from open_orders table (the real source for opens)
  const { rows: currentOpens } = await pool.query(
    `SELECT branch, category, COUNT(*) as cnt FROM open_orders
     WHERE open_month = $1
     GROUP BY branch, category`,
    [currentMonth]
  );
  
  const { rows: todayOpens } = await pool.query(
    `SELECT branch, category, COUNT(*) as cnt FROM open_orders
     WHERE received_date = $1
     GROUP BY branch, category`,
    [dates.yesterday]
  );
  
  const { rows: priorOpens } = await pool.query(
    `SELECT branch, category, COUNT(*) as cnt FROM open_orders
     WHERE open_month = $1
     GROUP BY branch, category`,
    [priorMonth]
  );
  
  // Initialize branch structure
  const branches = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];
  const categories = ['Purchase', 'Refinance', 'Escrow', 'TSG'];
  
  const report = {};
  for (const branch of branches) {
    report[branch] = {};
    for (const cat of categories) {
      report[branch][cat] = {
        today_closed: 0, today_rev: 0,
        mtd_closed: 0, mtd_rev: 0,
        prior_closed: 0, prior_rev: 0,
        today_open: 0, mtd_open: 0, prior_open: 0
      };
    }
  }
  
  // Process current month CLOSED orders (from order_summary)
  for (const order of currentOrders) {
    const branch = order.branch;
    const cat = order.category;
    if (!report[branch] || !report[branch][cat]) continue;
    
    const bucket = report[branch][cat];
    
    if (order.transaction_date) {
      const txDate = order.transaction_date.toISOString().split('T')[0];
      
      // MTD closed
      if (txDate >= dates.mtdStart && txDate <= dates.mtdEnd) {
        bucket.mtd_closed++;
        bucket.mtd_rev += parseFloat(order.total_revenue);
      }
      
      // Today closed (yesterday)
      if (dates.isCurrentMonth && txDate === dates.yesterday) {
        bucket.today_closed++;
        bucket.today_rev += parseFloat(order.total_revenue);
      }
    }
  }
  
  // Process prior month CLOSED orders (from order_summary)
  for (const order of priorOrders) {
    const branch = order.branch;
    const cat = order.category;
    if (!report[branch] || !report[branch][cat]) continue;
    
    const bucket = report[branch][cat];
    
    if (order.transaction_date) {
      bucket.prior_closed++;
      bucket.prior_rev += parseFloat(order.total_revenue);
    }
  }
  
  // Process OPEN order counts (from open_orders table)
  for (const row of currentOpens) {
    if (report[row.branch] && report[row.branch][row.category]) {
      report[row.branch][row.category].mtd_open += parseInt(row.cnt);
    }
  }
  
  for (const row of todayOpens) {
    if (dates.isCurrentMonth && report[row.branch] && report[row.branch][row.category]) {
      report[row.branch][row.category].today_open += parseInt(row.cnt);
    }
  }
  
  for (const row of priorOpens) {
    if (report[row.branch] && report[row.branch][row.category]) {
      report[row.branch][row.category].prior_open += parseInt(row.cnt);
    }
  }
  
  // Calculate totals per branch
  for (const branch of branches) {
    report[branch].totals = { 
      today_closed: 0, today_rev: 0, mtd_closed: 0, mtd_rev: 0,
      prior_closed: 0, prior_rev: 0, today_open: 0, mtd_open: 0, prior_open: 0
    };
    for (const cat of categories) {
      const b = report[branch][cat];
      const t = report[branch].totals;
      t.today_closed += b.today_closed; t.today_rev += b.today_rev;
      t.mtd_closed += b.mtd_closed; t.mtd_rev += b.mtd_rev;
      t.prior_closed += b.prior_closed; t.prior_rev += b.prior_rev;
      t.today_open += b.today_open; t.mtd_open += b.mtd_open;
      t.prior_open += b.prior_open;
    }
  }
  
  // Grand totals
  const grandTotal = { 
    today_closed: 0, today_rev: 0, mtd_closed: 0, mtd_rev: 0,
    prior_closed: 0, prior_rev: 0, today_open: 0, mtd_open: 0, prior_open: 0
  };
  for (const branch of branches) {
    const t = report[branch].totals;
    grandTotal.today_closed += t.today_closed; grandTotal.today_rev += t.today_rev;
    grandTotal.mtd_closed += t.mtd_closed; grandTotal.mtd_rev += t.mtd_rev;
    grandTotal.prior_closed += t.prior_closed; grandTotal.prior_rev += t.prior_rev;
    grandTotal.today_open += t.today_open; grandTotal.mtd_open += t.mtd_open;
    grandTotal.prior_open += t.prior_open;
  }
  
  return {
    report,
    grandTotal,
    dates,
    meta: { currentMonth, priorMonth, branches, categories }
  };
}

// ============================================
// REPORT 2: R-14 SALES REP BRANCHES
// ============================================
// Closed orders & revenue by sales rep, grouped by branch, broken down by order type

async function r14Branches(month, year) {
  const dates = getDateParams(month, year);
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1);
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Fetch orders with transaction_date (closed orders only)
  const { rows: currentOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL',
    [currentMonth]
  );
  const { rows: priorOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL',
    [priorMonth]
  );
  
  // Closing ratio: 4-month window
  // Created = orders opened in the window (from open_orders table)
  const { rows: createdInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM open_orders 
     WHERE received_date >= $1 AND received_date <= $2
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  // Closed = orders with revenue in the window (from order_summary table)
  const { rows: closedInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM order_summary 
     WHERE transaction_date >= $1 AND transaction_date <= $2
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  
  const branches = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];
  const categories = ['Purchase', 'Refinance', 'Escrow', 'TSG'];
  
  // Build: branch -> salesRep -> metrics
  const report = {};
  
  function ensureRep(branch, rep) {
    if (!report[branch]) report[branch] = {};
    if (!report[branch][rep]) {
      const entry = {};
      for (const cat of categories) {
        entry[cat] = {
          today_cnt: 0, today_rev: 0,
          mtd_cnt: 0, mtd_rev: 0,
          prior_cnt: 0, prior_rev: 0
        };
      }
      entry.totals = { today_rev: 0, mtd_rev: 0, prior_rev: 0 };
      entry.created_4m = 0;
      entry.closed_4m = 0;
      entry.closing_ratio = 0;
      report[branch][rep] = entry;
    }
    return report[branch][rep];
  }
  
  // Process current month
  for (const order of currentOrders) {
    const branch = order.branch;
    const cat = order.category;
    const rep = order.sales_rep || 'Unassigned';
    if (!branches.includes(branch)) continue;
    if (!categories.includes(cat)) continue;
    
    const entry = ensureRep(branch, rep);
    const txDate = order.transaction_date.toISOString().split('T')[0];
    
    if (txDate >= dates.mtdStart && txDate <= dates.mtdEnd) {
      entry[cat].mtd_cnt++;
      entry[cat].mtd_rev += parseFloat(order.total_revenue);
      entry.totals.mtd_rev += parseFloat(order.total_revenue);
    }
    
    if (dates.isCurrentMonth && txDate === dates.yesterday) {
      entry[cat].today_cnt++;
      entry[cat].today_rev += parseFloat(order.total_revenue);
      entry.totals.today_rev += parseFloat(order.total_revenue);
    }
  }
  
  // Process prior month
  for (const order of priorOrders) {
    const branch = order.branch;
    const cat = order.category;
    const rep = order.sales_rep || 'Unassigned';
    if (!branches.includes(branch)) continue;
    if (!categories.includes(cat)) continue;
    
    const entry = ensureRep(branch, rep);
    entry[cat].prior_cnt++;
    entry[cat].prior_rev += parseFloat(order.total_revenue);
    entry.totals.prior_rev += parseFloat(order.total_revenue);
  }
  
  // Closing ratio: build map from two separate populations
  const repClosingData = {};
  for (const row of createdInWindow) {
    const rep = row.sales_rep || 'Unassigned';
    if (!repClosingData[rep]) repClosingData[rep] = { created: 0, closed: 0 };
    repClosingData[rep].created = parseInt(row.cnt);
  }
  for (const row of closedInWindow) {
    const rep = row.sales_rep || 'Unassigned';
    if (!repClosingData[rep]) repClosingData[rep] = { created: 0, closed: 0 };
    repClosingData[rep].closed = parseInt(row.cnt);
  }
  
  // Apply closing ratios
  for (const branch of Object.keys(report)) {
    for (const rep of Object.keys(report[branch])) {
      const cr = repClosingData[rep];
      if (cr) {
        report[branch][rep].created_4m = cr.created;
        report[branch][rep].closed_4m = cr.closed;
        report[branch][rep].closing_ratio = cr.created > 0 
          ? Math.round((cr.closed / cr.created) * 100) 
          : 0;
      }
    }
  }
  
  // Remove inactive reps (all zeros)
  for (const branch of Object.keys(report)) {
    for (const rep of Object.keys(report[branch])) {
      const entry = report[branch][rep];
      const hasActivity = categories.some(cat => 
        entry[cat].today_cnt > 0 || entry[cat].mtd_cnt > 0 || entry[cat].prior_cnt > 0
      );
      if (!hasActivity) delete report[branch][rep];
    }
    if (Object.keys(report[branch]).length === 0) delete report[branch];
  }
  
  return { report, dates, meta: { currentMonth, priorMonth } };
}

// ============================================
// REPORT 3: R-14 SALES RANKING
// ============================================
// Flat ranking of all sales reps by MTD revenue, with projections

async function r14Ranking(month, year) {
  const dates = getDateParams(month, year);
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1);
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
  const { rows: currentOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL',
    [currentMonth]
  );
  const { rows: priorOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL',
    [priorMonth]
  );
  
  // Closing ratio: 4-month window
  // Created = orders opened in the window (from open_orders table)
  const { rows: createdInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM open_orders 
     WHERE received_date >= $1 AND received_date <= $2
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  // Closed = orders with revenue in the window (from order_summary table)
  const { rows: closedInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM order_summary 
     WHERE transaction_date >= $1 AND transaction_date <= $2
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  
  const reps = {};
  
  function ensureRep(name) {
    if (!reps[name]) {
      reps[name] = {
        sales_rep: name,
        mtd_cnt: 0, mtd_rev: 0,
        prior_cnt: 0, prior_rev: 0,
        today_cnt: 0, today_rev: 0,
        projected_rev: 0,
        created_4m: 0, closed_4m: 0, closing_ratio: 0
      };
    }
    return reps[name];
  }
  
  // Current month
  for (const order of currentOrders) {
    const rep = ensureRep(order.sales_rep || 'Unassigned');
    const txDate = order.transaction_date.toISOString().split('T')[0];
    
    if (txDate >= dates.mtdStart && txDate <= dates.mtdEnd) {
      rep.mtd_cnt++;
      rep.mtd_rev += parseFloat(order.total_revenue);
    }
    if (dates.isCurrentMonth && txDate === dates.yesterday) {
      rep.today_cnt++;
      rep.today_rev += parseFloat(order.total_revenue);
    }
  }
  
  // Prior month
  for (const order of priorOrders) {
    const rep = ensureRep(order.sales_rep || 'Unassigned');
    rep.prior_cnt++;
    rep.prior_rev += parseFloat(order.total_revenue);
  }
  
  // Closing ratio: build map from two separate populations
  const repClosingData = {};
  for (const row of createdInWindow) {
    const name = row.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    repClosingData[name].created = parseInt(row.cnt);
  }
  for (const row of closedInWindow) {
    const name = row.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    repClosingData[name].closed = parseInt(row.cnt);
  }
  
  for (const name of Object.keys(reps)) {
    const cr = repClosingData[name];
    if (cr) {
      reps[name].created_4m = cr.created;
      reps[name].closed_4m = cr.closed;
      reps[name].closing_ratio = cr.created > 0 ? Math.round((cr.closed / cr.created) * 100) : 0;
    }
    
    // Projected revenue
    if (dates.workedDays > 0) {
      const dailyRate = reps[name].mtd_rev / dates.workedDays;
      reps[name].projected_rev = dailyRate * (dates.workedDays + dates.remainingWorkingDays);
    }
  }
  
  // Sort by MTD revenue descending
  const ranking = Object.values(reps)
    .filter(r => r.mtd_cnt > 0 || r.prior_cnt > 0 || r.today_cnt > 0)
    .sort((a, b) => b.mtd_rev - a.mtd_rev);
  
  return { ranking, dates, meta: { currentMonth, priorMonth } };
}

// ============================================
// REPORT 4: TITLE OFFICER PRODUCTION
// ============================================
// Title officer closed orders grouped by officer's HOME BRANCH (from title_officer_branches table)
// Shows only title revenue (title_revenue + underwriter_revenue), excludes escrow & TSG revenue
// Purchase & Refinance categories ONLY

async function titleOfficerProduction(month, year) {
  const dates = getDateParams(month, year);
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1);
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Step A: Load title officer → home branch mapping
  const { rows: officerBranches } = await pool.query(
    'SELECT officer_name, branch FROM title_officer_branches WHERE is_active = true'
  );
  const officerBranchMap = {};
  officerBranches.forEach(ob => { officerBranchMap[ob.officer_name] = ob.branch; });
  
  // Track unknown officers we've already warned about (avoid duplicate logs)
  const warnedOfficers = new Set();
  
  // Only Purchase and Refinance orders
  const { rows: currentOrders } = await pool.query(
    `SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
     AND category IN ('Purchase', 'Refinance')`,
    [currentMonth]
  );
  const { rows: priorOrders } = await pool.query(
    `SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
     AND category IN ('Purchase', 'Refinance')`,
    [priorMonth]
  );
  
  // Closing ratio: 4-month window
  // Created = orders opened in the window (from open_orders, Purchase & Refinance only)
  const { rows: createdInWindow } = await pool.query(
    `SELECT title_officer, COUNT(*) as cnt FROM open_orders 
     WHERE received_date >= $1 AND received_date <= $2
     AND category IN ('Purchase', 'Refinance')
     GROUP BY title_officer`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  // Closed = orders with revenue in the window (from order_summary, Purchase & Refinance only)
  const { rows: closedInWindow } = await pool.query(
    `SELECT title_officer, COUNT(*) as cnt FROM order_summary 
     WHERE transaction_date >= $1 AND transaction_date <= $2
     AND category IN ('Purchase', 'Refinance')
     GROUP BY title_officer`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  
  // Allowed branches (includes TSG since Susan Dana is mapped there)
  const allowedBranches = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];
  const categories = ['Purchase', 'Refinance'];
  const report = {};
  
  function ensureOfficer(branch, officer) {
    if (!report[branch]) report[branch] = {};
    if (!report[branch][officer]) {
      const entry = {};
      for (const cat of categories) {
        entry[cat] = {
          today_cnt: 0, today_rev: 0,
          mtd_cnt: 0, mtd_rev: 0,
          prior_cnt: 0, prior_rev: 0
        };
      }
      entry.totals = { today_rev: 0, mtd_rev: 0, prior_rev: 0 };
      entry.created_4m = 0;
      entry.closed_4m = 0;
      entry.closing_ratio = 0;
      report[branch][officer] = entry;
    }
    return report[branch][officer];
  }
  
  // Step B: Helper to resolve branch from officer mapping
  function getOfficerBranch(officer) {
    if (!officer || officer === 'Unassigned') return null;
    const branch = officerBranchMap[officer];
    if (!branch) {
      if (!warnedOfficers.has(officer)) {
        console.warn(`Unknown title officer: "${officer}" — not in branch mapping`);
        warnedOfficers.add(officer);
      }
      return 'Unassigned';
    }
    return branch;
  }
  
  // Step C: Title-only revenue = title_revenue + underwriter_revenue (excludes escrow & TSG)
  function getTitleRevenue(order) {
    return (parseFloat(order.title_revenue) || 0) + (parseFloat(order.underwriter_revenue) || 0);
  }
  
  // Current month — use officer branch mapping, title-only revenue
  for (const order of currentOrders) {
    const officer = order.title_officer || 'Unassigned';
    const branch = getOfficerBranch(officer);
    if (!branch || !allowedBranches.includes(branch)) continue;
    
    const cat = order.category;
    const rev = getTitleRevenue(order);
    
    const entry = ensureOfficer(branch, officer);
    const txDate = order.transaction_date.toISOString().split('T')[0];
    
    if (txDate >= dates.mtdStart && txDate <= dates.mtdEnd) {
      entry[cat].mtd_cnt++;
      entry[cat].mtd_rev += rev;
      entry.totals.mtd_rev += rev;
    }
    if (dates.isCurrentMonth && txDate === dates.yesterday) {
      entry[cat].today_cnt++;
      entry[cat].today_rev += rev;
      entry.totals.today_rev += rev;
    }
  }
  
  // Prior month — same logic
  for (const order of priorOrders) {
    const officer = order.title_officer || 'Unassigned';
    const branch = getOfficerBranch(officer);
    if (!branch || !allowedBranches.includes(branch)) continue;
    
    const cat = order.category;
    const rev = getTitleRevenue(order);
    
    const entry = ensureOfficer(branch, officer);
    entry[cat].prior_cnt++;
    entry[cat].prior_rev += rev;
    entry.totals.prior_rev += rev;
  }
  
  // Closing ratio: build map from two separate populations, using officer branch mapping
  const officerClosingData = {};
  for (const row of createdInWindow) {
    const name = row.title_officer || 'Unassigned';
    if (!officerClosingData[name]) officerClosingData[name] = { created: 0, closed: 0 };
    officerClosingData[name].created = parseInt(row.cnt);
  }
  for (const row of closedInWindow) {
    const name = row.title_officer || 'Unassigned';
    if (!officerClosingData[name]) officerClosingData[name] = { created: 0, closed: 0 };
    officerClosingData[name].closed = parseInt(row.cnt);
  }
  
  for (const branch of Object.keys(report)) {
    for (const officer of Object.keys(report[branch])) {
      const cr = officerClosingData[officer];
      if (cr) {
        report[branch][officer].created_4m = cr.created;
        report[branch][officer].closed_4m = cr.closed;
        report[branch][officer].closing_ratio = cr.created > 0 
          ? Math.round((cr.closed / cr.created) * 100) : 0;
      }
    }
  }
  
  // Remove inactive officers (no activity in any period)
  for (const branch of Object.keys(report)) {
    for (const officer of Object.keys(report[branch])) {
      const entry = report[branch][officer];
      const hasActivity = categories.some(cat =>
        entry[cat].today_cnt > 0 || entry[cat].mtd_cnt > 0 || entry[cat].prior_cnt > 0
      );
      if (!hasActivity) delete report[branch][officer];
    }
    if (Object.keys(report[branch]).length === 0) delete report[branch];
  }
  
  return { report, dates, meta: { currentMonth, priorMonth, categories } };
}

// ============================================
// REPORT 5: ESCROW PRODUCTION
// ============================================
// Escrow orders by sales rep by branch - "Title & Escrow" only

async function escrowProduction(month, year) {
  const dates = getDateParams(month, year);
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1);
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Only Escrow category orders
  const { rows: currentOrders } = await pool.query(
    `SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
     AND category = 'Escrow'`,
    [currentMonth]
  );
  const { rows: priorOrders } = await pool.query(
    `SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
     AND category = 'Escrow'`,
    [priorMonth]
  );
  
  // Closing ratio: 4-month window
  // Created = escrow orders opened in the window (from open_orders table)
  const { rows: createdInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM open_orders 
     WHERE received_date >= $1 AND received_date <= $2
     AND category = 'Escrow'
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  // Closed = escrow orders with revenue in the window (from order_summary table)
  const { rows: closedInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM order_summary 
     WHERE transaction_date >= $1 AND transaction_date <= $2
     AND category = 'Escrow'
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  
  const branches = ['Glendale', 'Orange', 'Inland Empire', 'Porterville'];
  const report = {};
  
  function ensureRep(branch, rep) {
    if (!report[branch]) report[branch] = {};
    if (!report[branch][rep]) {
      report[branch][rep] = {
        today_cnt: 0, today_rev: 0,
        mtd_cnt: 0, mtd_rev: 0,
        prior_cnt: 0, prior_rev: 0,
        created_4m: 0, closed_4m: 0, closing_ratio: 0
      };
    }
    return report[branch][rep];
  }
  
  // Current month
  for (const order of currentOrders) {
    const branch = order.branch;
    const rep = order.sales_rep || 'Unassigned';
    if (!branches.includes(branch)) continue;
    
    const entry = ensureRep(branch, rep);
    const txDate = order.transaction_date.toISOString().split('T')[0];
    
    if (txDate >= dates.mtdStart && txDate <= dates.mtdEnd) {
      entry.mtd_cnt++;
      entry.mtd_rev += parseFloat(order.total_revenue);
    }
    if (dates.isCurrentMonth && txDate === dates.yesterday) {
      entry.today_cnt++;
      entry.today_rev += parseFloat(order.total_revenue);
    }
  }
  
  // Prior month
  for (const order of priorOrders) {
    const branch = order.branch;
    const rep = order.sales_rep || 'Unassigned';
    if (!branches.includes(branch)) continue;
    
    const entry = ensureRep(branch, rep);
    entry.prior_cnt++;
    entry.prior_rev += parseFloat(order.total_revenue);
  }
  
  // Closing ratio: build map from two separate populations
  const repClosingData = {};
  for (const row of createdInWindow) {
    const name = row.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    repClosingData[name].created = parseInt(row.cnt);
  }
  for (const row of closedInWindow) {
    const name = row.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    repClosingData[name].closed = parseInt(row.cnt);
  }
  
  for (const branch of Object.keys(report)) {
    for (const rep of Object.keys(report[branch])) {
      const cr = repClosingData[rep];
      if (cr) {
        report[branch][rep].created_4m = cr.created;
        report[branch][rep].closed_4m = cr.closed;
        report[branch][rep].closing_ratio = cr.created > 0
          ? Math.round((cr.closed / cr.created) * 100) : 0;
      }
    }
  }
  
  // Remove inactive (check COUNTS only, not revenue — this fixes the old bug)
  for (const branch of Object.keys(report)) {
    for (const rep of Object.keys(report[branch])) {
      const entry = report[branch][rep];
      if (entry.today_cnt === 0 && entry.mtd_cnt === 0 && entry.prior_cnt === 0) {
        delete report[branch][rep];
      }
    }
    if (Object.keys(report[branch]).length === 0) delete report[branch];
  }
  
  return { report, dates, meta: { currentMonth, priorMonth } };
}

// ============================================
// REPORT 6: TSG PRODUCTION
// ============================================
// Trustee Sale Guarantee orders by sales rep by branch

async function tsgProduction(month, year) {
  const dates = getDateParams(month, year);
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1);
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;

  // Only TSG category orders
  const { rows: currentOrders } = await pool.query(
    `SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
     AND category = 'TSG'`,
    [currentMonth]
  );
  const { rows: priorOrders } = await pool.query(
    `SELECT * FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
     AND category = 'TSG'`,
    [priorMonth]
  );

  // Closing ratio: 4-month window
  const { rows: createdInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM open_orders 
     WHERE received_date >= $1 AND received_date <= $2
     AND category = 'TSG'
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );
  const { rows: closedInWindow } = await pool.query(
    `SELECT sales_rep, COUNT(*) as cnt FROM order_summary 
     WHERE transaction_date >= $1 AND transaction_date <= $2
     AND category = 'TSG'
     GROUP BY sales_rep`,
    [dates.closingRatioStart, dates.closingRatioEnd]
  );

  const branches = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];
  const report = {};

  function ensureRep(branch, rep) {
    if (!report[branch]) report[branch] = {};
    if (!report[branch][rep]) {
      report[branch][rep] = {
        today_cnt: 0, today_rev: 0,
        mtd_cnt: 0, mtd_rev: 0,
        prior_cnt: 0, prior_rev: 0,
        created_4m: 0, closed_4m: 0, closing_ratio: 0
      };
    }
    return report[branch][rep];
  }

  // Current month
  for (const order of currentOrders) {
    const branch = order.branch;
    const rep = order.sales_rep || 'Unassigned';
    if (!branches.includes(branch)) continue;

    const entry = ensureRep(branch, rep);
    const txDate = order.transaction_date.toISOString().split('T')[0];

    if (txDate >= dates.mtdStart && txDate <= dates.mtdEnd) {
      entry.mtd_cnt++;
      entry.mtd_rev += parseFloat(order.total_revenue);
    }
    if (dates.isCurrentMonth && txDate === dates.yesterday) {
      entry.today_cnt++;
      entry.today_rev += parseFloat(order.total_revenue);
    }
  }

  // Prior month
  for (const order of priorOrders) {
    const branch = order.branch;
    const rep = order.sales_rep || 'Unassigned';
    if (!branches.includes(branch)) continue;

    const entry = ensureRep(branch, rep);
    entry.prior_cnt++;
    entry.prior_rev += parseFloat(order.total_revenue);
  }

  // Closing ratio: build map
  const repClosingData = {};
  for (const row of createdInWindow) {
    const name = row.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    repClosingData[name].created = parseInt(row.cnt);
  }
  for (const row of closedInWindow) {
    const name = row.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    repClosingData[name].closed = parseInt(row.cnt);
  }

  for (const branch of Object.keys(report))
    for (const rep of Object.keys(report[branch])) {
      const cr = repClosingData[rep];
      if (cr) {
        report[branch][rep].created_4m = cr.created;
        report[branch][rep].closed_4m = cr.closed;
        report[branch][rep].closing_ratio = cr.created > 0
          ? Math.round((cr.closed / cr.created) * 100) : 0;
      }
    }

  // Remove inactive
  for (const branch of Object.keys(report)) {
    for (const rep of Object.keys(report[branch])) {
      const entry = report[branch][rep];
      if (entry.today_cnt === 0 && entry.mtd_cnt === 0 && entry.prior_cnt === 0) {
        delete report[branch][rep];
      }
    }
    if (Object.keys(report[branch]).length === 0) delete report[branch];
  }

  return { report, dates, meta: { currentMonth, priorMonth } };
}

module.exports = {
  dailyRevenue,
  r14Branches,
  r14Ranking,
  titleOfficerProduction,
  escrowProduction,
  tsgProduction
};
