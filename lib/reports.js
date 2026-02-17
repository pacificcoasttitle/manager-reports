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
  
  // Fetch both months from order_summary
  const { rows: currentOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1',
    [currentMonth]
  );
  
  const { rows: priorOrders } = await pool.query(
    'SELECT * FROM order_summary WHERE fetch_month = $1',
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
  
  // Process current month orders (MTD closed & today closed)
  for (const order of currentOrders) {
    const branch = order.branch;
    const cat = order.category;
    if (!report[branch] || !report[branch][cat]) continue;
    
    const bucket = report[branch][cat];
    
    // Closed = has transaction_date in period
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
    
    // Open = has received_date in period
    if (order.received_date) {
      const rxDate = order.received_date.toISOString().split('T')[0];
      
      if (rxDate >= dates.mtdStart && rxDate <= dates.mtdEnd) {
        bucket.mtd_open++;
      }
      
      if (dates.isCurrentMonth && rxDate === dates.yesterday) {
        bucket.today_open++;
      }
    }
  }
  
  // Process prior month orders
  for (const order of priorOrders) {
    const branch = order.branch;
    const cat = order.category;
    if (!report[branch] || !report[branch][cat]) continue;
    
    const bucket = report[branch][cat];
    
    if (order.transaction_date) {
      bucket.prior_closed++;
      bucket.prior_rev += parseFloat(order.total_revenue);
    }
    
    if (order.received_date) {
      bucket.prior_open++;
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
  
  // Closing ratio: need 3 months back
  const closingMonths = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    closingMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const { rows: closingOrders } = await pool.query(
    'SELECT file_number, sales_rep, transaction_date, received_date FROM order_summary WHERE fetch_month = ANY($1)',
    [closingMonths]
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
  
  // Closing ratio calculation
  const repClosingData = {};
  for (const order of closingOrders) {
    const rep = order.sales_rep || 'Unassigned';
    if (!repClosingData[rep]) repClosingData[rep] = { created: 0, closed: 0 };
    if (order.received_date) repClosingData[rep].created++;
    if (order.transaction_date) repClosingData[rep].closed++;
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
  
  return { report, dates, meta: { currentMonth, priorMonth, closingMonths } };
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
  
  // Closing ratio months
  const closingMonths = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    closingMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const { rows: closingOrders } = await pool.query(
    'SELECT sales_rep, transaction_date, received_date FROM order_summary WHERE fetch_month = ANY($1)',
    [closingMonths]
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
  
  // Closing ratio
  const repClosingData = {};
  for (const order of closingOrders) {
    const name = order.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    if (order.received_date) repClosingData[name].created++;
    if (order.transaction_date) repClosingData[name].closed++;
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
// Title officer closed orders by branch - Purchase & Refinance ONLY

async function titleOfficerProduction(month, year) {
  const dates = getDateParams(month, year);
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonthDate = new Date(year, month - 2, 1);
  const priorMonth = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  
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
  
  // Closing ratio
  const closingMonths = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    closingMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const { rows: closingOrders } = await pool.query(
    `SELECT title_officer, transaction_date, received_date FROM order_summary 
     WHERE fetch_month = ANY($1) AND category IN ('Purchase', 'Refinance')`,
    [closingMonths]
  );
  
  const branches = ['Glendale', 'Orange', 'Inland Empire', 'Porterville'];
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
  
  // Current month
  for (const order of currentOrders) {
    const branch = order.branch;
    const cat = order.category;
    const officer = order.title_officer || 'Unassigned';
    if (!branches.includes(branch)) continue;
    
    const entry = ensureOfficer(branch, officer);
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
  
  // Prior month
  for (const order of priorOrders) {
    const branch = order.branch;
    const cat = order.category;
    const officer = order.title_officer || 'Unassigned';
    if (!branches.includes(branch)) continue;
    
    const entry = ensureOfficer(branch, officer);
    entry[cat].prior_cnt++;
    entry[cat].prior_rev += parseFloat(order.total_revenue);
    entry.totals.prior_rev += parseFloat(order.total_revenue);
  }
  
  // Closing ratio
  const officerClosingData = {};
  for (const order of closingOrders) {
    const name = order.title_officer || 'Unassigned';
    if (!officerClosingData[name]) officerClosingData[name] = { created: 0, closed: 0 };
    if (order.received_date) officerClosingData[name].created++;
    if (order.transaction_date) officerClosingData[name].closed++;
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
  
  // Remove inactive
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
  
  return { report, dates, meta: { currentMonth, priorMonth, closingMonths, categories } };
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
  
  // Closing ratio
  const closingMonths = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    closingMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const { rows: closingOrders } = await pool.query(
    `SELECT sales_rep, transaction_date, received_date FROM order_summary 
     WHERE fetch_month = ANY($1) AND category = 'Escrow'`,
    [closingMonths]
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
  
  // Closing ratio
  const repClosingData = {};
  for (const order of closingOrders) {
    const name = order.sales_rep || 'Unassigned';
    if (!repClosingData[name]) repClosingData[name] = { created: 0, closed: 0 };
    if (order.received_date) repClosingData[name].created++;
    if (order.transaction_date) repClosingData[name].closed++;
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
  
  return { report, dates, meta: { currentMonth, priorMonth, closingMonths } };
}

module.exports = {
  dailyRevenue,
  r14Branches,
  r14Ranking,
  titleOfficerProduction,
  escrowProduction
};
