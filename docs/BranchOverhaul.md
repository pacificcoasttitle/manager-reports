
Branch assignment overhaul: hybrid logic + reconciliation bar
This is the definitive branch assignment change. Each report uses the correct branch source based on what type of revenue it represents. A reconciliation bar proves the math on every page.
The business rules (final)
ReportBranch determined byWhyBranches visibleDaily RevenueTitle officer mappingTitle revenue follows the officer who did the workGlendale, Orange, TSGR-14 BranchesFile number suffixSales reps bring deals to a specific officeGlendale, Orange, Inland Empire, Porterville, TSGR-14 RankingNo branch (flat)Company-wide rankingN/ATitle OfficerTitle officer mappingOfficer production reportGlendale, Orange, TSGEscrow ProductionFile number suffixEscrow work done at local branchGlendale, Orange, Inland Empire, Porterville, TSG
The golden rule
Daily Revenue Total + Escrow Production Total = R-14 Ranking Total = Grand Total
This must always be true. The reconciliation bar proves it on every page load.
Step 1: Backend — restore file number branch helper
In lib/reports.js, add back the file number branch parser alongside the officer branch helper:
jsfunction getBranchFromFileNumber(fileNumber) {
  if (!fileNumber) return 'Unassigned';
  const suffix = fileNumber.split('-').pop();
  switch (suffix) {
    case 'GLT': return 'Glendale';
    case 'OCT': return 'Orange';
    case 'ONT': return 'Inland Empire';
    case 'PRV': return 'Porterville';
    case 'TSG': return 'TSG';
    default:
      // TSG file numbers start with 99
      if (fileNumber.startsWith('99')) return 'TSG';
      return 'Unassigned';
  }
}

// Already exists — keep this
function getBranchFromOfficer(titleOfficer, officerBranchMap) {
  if (titleOfficer && officerBranchMap[titleOfficer]) {
    return officerBranchMap[titleOfficer];
  }
  return 'Unassigned';
}
Both helpers stay in reports.js. Each report function chooses which one to use.
Step 2: Backend — update each report function
dailyRevenue() — KEEP title officer branch (no change)
Already uses getBranchFromOfficer(). Shows Purchase + Refi + TSG only. Branches: Glendale, Orange, TSG. No change needed.
r14Branches() — CHANGE to file number branch
Currently uses getBranchFromOfficer(). Change to getBranchFromFileNumber():
js// Replace:
const branch = getBranchForOrder(order, officerBranchMap);

// With:
const branch = getBranchFromFileNumber(order.file_number);
This brings back Inland Empire and Porterville as branch sections when sales reps have orders with those file prefixes. The report shows ALL revenue types (Purchase, Refi, Escrow, TSG) per rep per branch.
r14Ranking() — NO CHANGE
Flat list, no branch grouping. Already correct.
titleOfficerProduction() — KEEP title officer branch (no change)
Already uses officer mapping. Shows title + underwriter revenue only. Branches: Glendale, Orange, TSG. No change needed.
escrowProduction() — CHANGE to file number branch
Currently uses getBranchFromOfficer(). Change to getBranchFromFileNumber():
js// Replace:
const branch = getBranchForOrder(order, officerBranchMap);

// With:
const branch = getBranchFromFileNumber(order.file_number);
This brings back Inland Empire and Porterville as branch sections. These branches have escrow operations but no in-house title officers — escrow revenue should credit where the escrow work was done.
Open orders in dailyRevenue() — KEEP title officer branch
Open order counts on Daily Revenue use officer mapping. No change needed.
Open orders in closing ratios for r14Branches() and escrowProduction() — CHANGE to file number
When calculating closing ratios in R-14 Branches and Escrow Production, the open orders query should also group by file number branch to stay consistent:
js// For R-14 Branches and Escrow Production closing ratios:
const branch = getBranchFromFileNumber(openOrder.file_number);
Step 3: Backend — add reconciliation endpoint
Add a new API route that returns the three totals for the reconciliation bar:
jsapp.get('/api/reports/reconciliation', async (req, res) => {
  const { month, year } = req.query;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  
  try {
    // Total from Daily Revenue perspective (Purchase + Refi + TSG by officer branch)
    const { rows: dailyRevRows } = await pool.query(`
      SELECT 
        ROUND(SUM(CASE WHEN category IN ('Purchase', 'Refinance', 'TSG') THEN total_revenue ELSE 0 END)::numeric, 2) as daily_revenue_total,
        ROUND(SUM(CASE WHEN category = 'Escrow' THEN total_revenue ELSE 0 END)::numeric, 2) as escrow_total,
        ROUND(SUM(total_revenue)::numeric, 2) as grand_total,
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE category IN ('Purchase', 'Refinance', 'TSG')) as title_orders,
        COUNT(*) FILTER (WHERE category = 'Escrow') as escrow_orders
      FROM order_summary
      WHERE fetch_month = $1
    `, [yearMonth]);
    
    // R-14 Ranking total (should match grand total)
    const { rows: rankingRows } = await pool.query(`
      SELECT ROUND(SUM(total_revenue)::numeric, 2) as ranking_total
      FROM order_summary
      WHERE fetch_month = $1
        AND sales_rep IS NOT NULL AND sales_rep != ''
    `, [yearMonth]);
    
    // Revenue breakdown by type
    const { rows: breakdownRows } = await pool.query(`
      SELECT 
        ROUND(SUM(title_revenue)::numeric, 2) as title_rev,
        ROUND(SUM(escrow_revenue)::numeric, 2) as escrow_rev,
        ROUND(SUM(tsg_revenue)::numeric, 2) as tsg_rev,
        ROUND(SUM(underwriter_revenue)::numeric, 2) as uw_rev,
        ROUND(SUM(total_revenue)::numeric, 2) as total_rev
      FROM order_summary
      WHERE fetch_month = $1
    `, [yearMonth]);
    
    const daily = parseFloat(dailyRevRows[0].daily_revenue_total) || 0;
    const escrow = parseFloat(dailyRevRows[0].escrow_total) || 0;
    const grand = parseFloat(dailyRevRows[0].grand_total) || 0;
    const ranking = parseFloat(rankingRows[0].ranking_total) || 0;
    
    // Orders with no sales rep (in grand total but not in ranking)
    const unassignedRevenue = grand - ranking;
    
    const reconciled = Math.abs((daily + escrow) - grand) < 0.01;
    const rankingMatch = Math.abs(ranking - grand) < 1.00; // allow $1 rounding
    
    res.json({
      dailyRevenueTotal: daily,
      escrowTotal: escrow,
      grandTotal: grand,
      rankingTotal: ranking,
      unassignedRevenue: unassignedRevenue,
      titleOrders: parseInt(dailyRevRows[0].title_orders),
      escrowOrders: parseInt(dailyRevRows[0].escrow_orders),
      totalOrders: parseInt(dailyRevRows[0].total_orders),
      breakdown: breakdownRows[0],
      reconciled: reconciled,
      rankingMatch: rankingMatch,
      checks: {
        dailyPlusEscrow: reconciled ? '✓' : '✗',
        rankingMatchesTotal: rankingMatch ? '✓' : '✗',
        formula: `Daily Revenue ($${daily.toLocaleString()}) + Escrow ($${escrow.toLocaleString()}) = $${(daily + escrow).toLocaleString()} vs Grand Total $${grand.toLocaleString()}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## Step 4: Frontend — add reconciliation bar component

Create `frontend/components/ReconciliationBar.js`:

This component sits above the KPI cards on every report page. It fetches from `/api/reports/reconciliation` and displays:
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ✓ Numbers Reconciled                                                        │
│                                                                              │
│  Title Business    +    Escrow Business    =    Grand Total    =  R-14 Total │
│  $842,215               $162,150               $1,004,365        $1,004,365  │
│  (547 orders)           (142 orders)           (689 orders)       ✓ Match    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Design specs:
- Full width, sits between the month selector and the KPI cards
- Background: `#f0fdf4` (light green) with border `#86efac` when reconciled
- Background: `#fef2f2` (light red) with border `#fca5a5` when NOT reconciled
- Font size: 13px for labels, 18px bold for dollar amounts
- Checkmark icon (✓) in green when matched, (✗) in red when not
- Four columns evenly spaced with + and = signs between them
- Compact — should not take more than ~80px height
- Always visible, loads with every report

If NOT reconciled, show a warning message below:
```
⚠️ Revenue mismatch detected: Daily ($842,215) + Escrow ($162,150) = $1,004,365 but Grand Total = $1,004,500. Difference: $135. Check Discrepancies tab.
Step 5: Frontend — add ReconciliationBar to page.js
Import and render the bar on every report view:
jsximport ReconciliationBar from './components/ReconciliationBar';

// Inside the main content area, after month selector, before KPI cards:
<ReconciliationBar month={selectedMonth} year={selectedYear} />
```

It should appear on ALL tabs: Daily Revenue, R-14 Branches, R-14 Ranking, Title Officer, Escrow Production. Same data, same bar. The numbers don't change between tabs — it's the company-wide truth.

## Step 6: Frontend — Escrow Production and R-14 Branches branch handling

### EscrowProductionReport.js
Remove any hardcoded branch list. Render branches dynamically from the API response. With file number branch assignment, the API will now return: Glendale, Orange, Inland Empire, Porterville, TSG (and possibly Unassigned).

Sort branches alphabetically but put "Unassigned" last.

### R14BranchesReport.js
Same — render branches dynamically. Will now show: Glendale, Inland Empire, Orange, Porterville, TSG.

Sort branches alphabetically but put "Unassigned" last.

## Step 7: Update Tessa's system prompt

In `lib/tessa.js`, update the BRANCHES section:
```
BRANCH ASSIGNMENT (HYBRID LOGIC):
- Daily Revenue and Title Officer reports: branch = title officer's home branch
  (Jim Jean & Clive Virata → Orange, Eddie LasMarias & Rachel Barcena → Glendale, Susan Dana → TSG)
- R-14 Branches and Escrow Production: branch = file number suffix
  (GLT → Glendale, OCT → Orange, ONT → Inland Empire, PRV → Porterville, TSG → TSG)
- R-14 Ranking: no branch grouping (flat list)
- Inland Empire and Porterville have no in-house title officers. Their title work is done by Orange/Glendale officers. So title revenue credits the officer's branch, but escrow revenue credits the file's branch.
- The grand total is always the same regardless of branch routing.
Step 8: Update daily email
The daily email currently uses title officer branch for everything. Update it to match the hybrid logic:

Yesterday's Closings: Show by title officer branch (Glendale, Orange, TSG) — this is the title business view
Yesterday's Openings: Show by title officer branch — same
MTD section: Show by title officer branch — same
Add a one-line note at the bottom of the MTD section: "Escrow business (IE, Porterville): $XX,XXX MTD" — so the CEO sees the full picture without a separate table

Verification queries after deploying
sql-- 1. R-14 Branches total should equal Grand Total
-- (all orders have a file number so nothing should be lost)
SELECT ROUND(SUM(total_revenue)::numeric, 2) as grand_total
FROM order_summary WHERE fetch_month = '2026-02';

-- 2. Escrow Production by file branch should show IE and Porterville
SELECT 
  CASE 
    WHEN file_number LIKE '%-GLT' THEN 'Glendale'
    WHEN file_number LIKE '%-OCT' THEN 'Orange'
    WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
    WHEN file_number LIKE '%-PRV' THEN 'Porterville'
    ELSE 'Other'
  END as branch,
  COUNT(*) as orders,
  ROUND(SUM(total_revenue)::numeric, 2) as revenue
FROM order_summary
WHERE fetch_month = '2026-02' AND category = 'Escrow'
GROUP BY branch ORDER BY branch;

-- 3. Daily Revenue total + Escrow total should equal Grand Total
SELECT 
  ROUND(SUM(CASE WHEN category IN ('Purchase','Refinance','TSG') THEN total_revenue ELSE 0 END)::numeric, 2) as daily_rev,
  ROUND(SUM(CASE WHEN category = 'Escrow' THEN total_revenue ELSE 0 END)::numeric, 2) as escrow_rev,
  ROUND(SUM(total_revenue)::numeric, 2) as grand_total
FROM order_summary WHERE fetch_month = '2026-02';

-- 4. The 18 mismatched orders should now show correctly:
-- IE/PRV files should appear under IE/PRV in R-14 Branches and Escrow
-- But under Orange/Glendale in Daily Revenue and Title Officer
Summary of changes
FileChangelib/reports.jsAdd getBranchFromFileNumber(). Update r14Branches() and escrowProduction() to use file number branch. Keep dailyRevenue() and titleOfficerProduction() on officer branch.server.jsAdd /api/reports/reconciliation endpointlib/tessa.jsUpdate branch explanation in system promptlib/daily-email.jsAdd escrow footnote to MTD sectionfrontend/components/ReconciliationBar.jsNew component — reconciliation proof barfrontend/app/page.jsImport and render ReconciliationBar on all tabsfrontend/components/R14BranchesReport.jsDynamic branches (will now include IE, Porterville)frontend/components/EscrowProductionReport.jsDynamic branches (will now include IE, Porterville)
What NOT to change

DailyRevenueReport.js — no change (already correct with officer branch)
TitleOfficerReport.js — no change (already correct with officer branch)
R14RankingReport.js — no change (flat list, no branches)
discrepancies.js — no change
title_officer_branches table — no change
Revenue import — no change
Open orders import — no change


After this ships, every dollar is accounted for. The reconciliation bar proves it on every page. Title revenue follows the officer, escrow revenue follows the file, 