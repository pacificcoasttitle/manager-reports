# CLAUDE.md — Pacific Coast Title Management Reports

This file contains the rules, conventions, and architectural decisions for the PCT Management Reports dashboard. Any future development MUST follow these rules to avoid breaking what we've built.

---

## 1. The Golden Rule

**The reconciliation bar must always be green.**

```
Title Officer Revenue + Escrow Revenue + TSG Revenue = Grand Total = R-14 Total ✓
```

If you make a change and the reconciliation bar turns red, STOP and figure out why before proceeding. The numbers must always reconcile.

---

## 2. Data Sources & Architecture

### Tech Stack
- **Backend:** Node/Express on Render
- **Database:** PostgreSQL on Render (`manger_reports_db`)
- **Frontend:** Next.js on Vercel (`manager-reports-one.vercel.app`)
- **Data Source:** SoftPro internal API at `http://100.29.181.61:3000/api/`
- **Email:** SendGrid (sender: `ghernandez@pct.com`)
- **AI:** Anthropic Claude API (for Tessa)

### Database Tables
- `order_summary` — Closed orders with aggregated revenue. One row per order.
- `revenue_line_items` — Raw bill code line items from SoftPro. Many rows per order. Read-only audit trail.
- `open_orders` — All orders received in a month, regardless of close status.
- `title_officer_branches` — Maps title officers to their home branches.
- `bill_code_classifications` — Brandon-managed classification of bill codes (revenue/fee/pass-through/excluded).
- `app_settings` — Email recipients, cron schedule, feature flags.
- `import_log` — Audit trail of every automated and manual import.

### Data Sources
- **Revenue (closed orders):** SoftPro API `powerbi/createExcel?userPostedDate=YYYY-MM-DD`. Automated nightly.
- **Open orders:** SoftPro API `powerbi/getOpeningData?userPostedDate=YYYY-MM-01`. Automated nightly.
- **Both:** Fully automated. No Excel imports needed.

---

## 3. Business Rules

### Branch Assignment (Hybrid Logic)

Different reports use different branch sources because they answer different questions:

| Report | Branch Source | Why |
|---|---|---|
| Title Revenue (Daily Revenue) | Title officer mapping | Title revenue follows the officer who did the work |
| Title Officer Production | Title officer mapping | Officer production report |
| R-14 Branches | File number suffix | Where the deal was filed |
| R-14 Ranking | None (flat) | Company-wide ranking |
| Escrow Production | File number suffix | Where escrow work was done |
| Discrepancies | Mixed | Per-check basis |

**File number → branch mapping:**
- `-GLT` → Glendale
- `-OCT` → Orange
- `-ONT` → Inland Empire
- `-PRV` → Porterville
- `-TSG` or starts with `99` → TSG
- Anything else → Unassigned

**Title officer → branch mapping:**
- Jim Jean → Orange
- Clive Virata → Orange
- Eddie LasMarias → Glendale (no space in last name!)
- Rachel Barcena → Glendale
- Susan Dana → TSG

### Revenue Categorization

Categories are set during import based on order_type + trans_type:

- `Trustee Sale Guarantee` → **TSG**
- `Title & Escrow` (any trans_type) → **Escrow**
- `Escrow Only` → **Escrow**
- `Title only` + `Purchase` → **Purchase**
- `Title only` + `Refinance` → **Refinance**

### Report Inclusion Rules (NOT category-based)

**This is critical.** Reports filter by REVENUE TYPE, not category. This is because Title & Escrow orders have BOTH title and escrow revenue, and each report shows only its portion.

- **Title Officer Production**: includes orders where `(title_revenue + underwriter_revenue) > 0`. Revenue shown = title + UW only.
- **Escrow Production**: includes orders where `escrow_revenue > 0`. Revenue shown = escrow only.
- **Title Revenue (Daily Revenue)**: includes orders where `(title_revenue + underwriter_revenue + tsg_revenue) > 0`. Revenue shown = title + UW + TSG (no escrow).
- **R-14 Branches**: includes all orders. Revenue shown = total_revenue.
- **R-14 Ranking**: includes all orders. Revenue shown = total_revenue.

T&E orders appear in BOTH Title Officer AND Escrow Production reports — each showing only their respective revenue portion.

### Revenue Bill Codes (captured)
- `TPC` — Title Premiums Commonwealth → `title_revenue`
- `TPW` — Title Premiums Westcor → `title_revenue`
- `ESC` — Escrow Fees → `escrow_revenue`
- `TSGW` — TSG Westcor → `tsg_revenue`
- `UPRE` — UW Title Premiums → `underwriter_revenue`

### Bill Codes EXCLUDED from Revenue
- Any charge_description matching `/withholding|593|FIRPTA/i` is excluded even if it has a revenue bill code. These are tax pass-throughs.
- Pass-through codes (always excluded): `RTAX`, `REC`, `RECSF`, `WIRE`, `COU`, `DEL`.

### Test Data Filtering
- File numbers starting with `TEST` or `AR TEST` are skipped on import.
- Profiles containing "Test & Training" are skipped on import.

### Date Conventions
- **"Today" = yesterday** (1-day lag). Reports always lag because SoftPro syncs overnight.
- All date math uses **Pacific time**, NOT server UTC.
- `transaction_date` = revenue recognition date (when order was sent to accounting).
- `received_date` = order opened date.
- `fetch_month` = "YYYY-MM" format, used for partitioning.

### Working Days
- Monday–Friday only. No holiday exclusions.
- Projected Revenue = `(MTD Revenue / Working Days Elapsed) × Total Working Days in Month`.

### Closing Ratio
- Formula: `(Orders Closed in 4-month window / Orders Opened in 4-month window) × 100`
- Window: 4 months back from selected month
- "Opened" comes from `open_orders` (received_date)
- "Closed" comes from `order_summary` (transaction_date)
- These are DIFFERENT populations — an order opened in Oct may close in Jan.
- Ratios above 100% are possible (backlog clearing).

---

## 4. What NOT to Change

These are LOAD-BEARING. Changing them will break reconciliation:

- The 5 revenue bill codes (TPC, TPW, ESC, TSGW, UPRE) — only Brandon can change via Bill Code Manager.
- The `total_revenue` formula: `title + escrow + tsg + underwriter`.
- The branch mapping tables (`title_officer_branches`, file number suffix logic).
- The withholding/FIRPTA exclusion filter.
- The TEST data filter on import.
- The `order_summary` schema (without migrating reports too).
- The reconciliation endpoint logic.

---

## 5. Development Workflow

### Architecture & Strategy → Claude (this chat)
- Brainstorming features
- Database schema decisions
- Business logic design
- Cursor prompt generation
- Code review of changes

### Implementation → Cursor
- All code changes go through Cursor
- Cursor receives detailed prompts from Claude with exact code snippets
- Always include a "What NOT to change" section

### Standard Prompt Structure
1. **Goal** — what we're building, why
2. **Step-by-step changes** — file by file with code
3. **Verification queries** — SQL or curl commands to test
4. **What NOT to change** — load-bearing items

### Numerical Validation
Always validate numerically before declaring something done:
- Counts match between expected and actual
- Dollar totals reconcile
- Reconciliation bar is green
- Discrepancies tab shows no new criticals

---

## 6. Key Workflows

### Adding a new bill code as revenue
1. Brandon classifies it in the Bill Code Manager UI
2. Click "Re-import current month" to refresh aggregates
3. Verify reconciliation bar still green
4. Verify totals went up by expected amount

### Adding a new title officer
1. Insert into `title_officer_branches` table
2. Discrepancy check #13 confirms no unmapped officers remain
3. Run a re-import to refresh branch assignments

### Adding a new feature
1. Read this CLAUDE.md first
2. Identify which load-bearing items could be affected
3. Write a Cursor prompt with explicit "do not change" guardrails
4. Verify reconciliation after deploy

### Diagnosing a number mismatch
1. Check reconciliation bar — green means our math is internally consistent
2. If reconciliation green but PowerBI mismatch: look for SoftPro data quality issues
3. Common culprits: test orders, withholding charges, duplicate file numbers, unmapped officers
4. Use the Discrepancies tab — 13 automated checks
5. Use Tessa for ad-hoc investigation
6. Use Live Data Explorer to drill into specific orders

---

## 7. Automated Systems

### Nightly Cron (9 PM Pacific)
1. Fetch revenue (closed orders) from SoftPro
2. Fetch open orders from SoftPro
3. Send daily report email to recipients
4. Log to `import_log` table

### Daily Email Report
- Sent to recipients in `daily_email_recipients` setting
- From: `ghernandez@pct.com` (SendGrid verified sender)
- Layout: Option B (branches as columns)
- Three blocks: Yesterday's Closings, Yesterday's Openings, Month-to-Date
- Bottom: Top 5 Reps + Dashboard link

### Discrepancies Tab (13 automated checks)
Critical:
1. Zero revenue orders
2. T&E orders missing escrow revenue
3. Unknown/missing branch
4. Duplicate file numbers
5. Branch revenue dropped >30%
6. Pipeline dropped >30%

Warning:
7. Closed orders never opened
8. Missing personnel
9. Low closing ratio (<25%)
10. Rep went to zero orders

Info:
11. High closing ratio (>100%)
12. Unusually high revenue orders
13. Title officers not in branch mapping (catches name mismatches like the Eddie LasMarias incident)

---

## 8. Tessa AI

### Capabilities
- Conversational history (session-based)
- SQL transparency (View Query button)
- Business logic glossary in system prompt
- CFO-ready prompts: shows volume AND value, percentage changes, reconciliation mode

### Database access
- SELECT only — never UPDATE/DELETE/INSERT/DDL
- 2048 token limit per response
- Logs every question to history for re-use

### When Tessa is wrong
- Check her SQL in the side panel
- Verify against Live Data Explorer
- If still wrong, the business logic glossary in `lib/tessa.js` may need updating

---

## 9. Transaction Desk API

### Authentication
- API key in `x-api-key` header
- Stored in Render env var `TD_API_KEY`
- Rate limited: 100 requests / 15 min

### Endpoints
- `GET /api/td/ping` — health check
- `GET /api/td/rep/:repName?month=YYYY-MM` — single rep metrics
- `GET /api/td/leaderboard?month=YYYY-MM` — ranked rep list
- `GET /api/td/trends?repName=X` — current + prior year monthly
- `GET /api/td/production-history?year=Y&repName=X` — yearly monthly with ratios
- `GET /api/td/closings?month=M&year=Y&repName=X` — file-level drilldown

### Important
- TD endpoints use the SAME underlying data as the dashboard
- Changing report logic affects TD output too
- TD API responses use camelCase, dashboard uses snake_case internally

---

## 10. Common Pitfalls

1. **Name mismatches** — "Eddie LasMarias" vs "Eddie Las Marias" (no space) — caused $314K to disappear. Discrepancy #13 catches this now.
2. **Server timezone** — Render runs in UTC. Always use `America/Los_Angeles` for date math.
3. **Open orders branch** — they have a stored `branch` column but the reports compute it dynamically. Don't trust the stored value.
4. **Categories vs Revenue Type** — T&E orders are categorized as Escrow but have title revenue. Reports filter by revenue type, not category.
5. **Withholding charges** — SoftPro tags California Form 593 withholding as TPW. Filter by charge_description before adding to revenue.
6. **TEST orders** — Real-looking but file_number starts with TEST or AR TEST. Always filter.
7. **Trailing slashes in env vars** — `FRONTEND_URL` with trailing slash breaks CORS.
8. **Email recipients** — managed in `app_settings`, NOT env vars. Env var is only for sender (must match SendGrid verified).

---

## 11. Stakeholders

- **Jerry Hernandez** — Product Development Manager, project owner
- **Brandon** — CFO, primary stakeholder, reviews numbers
- **Dalia** — Brandon's assistant
- **CEO** — Receives daily email report only, doesn't log in

---

## 12. Production URLs

- Dashboard: `https://manager-reports-one.vercel.app`
- API: `https://manager-reports.onrender.com`
- Password (basic auth): `pct2026`

### Closings vs Openings sub-tabs

Every production report has two sub-tabs:
- **Closings** (default): revenue and count of orders that closed with revenue (uses `transaction_date`).
- **Openings**: count of orders received (uses `received_date` for "today", `open_month` for MTD/prior). No revenue columns — revenue is recognized at close.

Both views use the same per-report population filter (Title only + T&E for title reports; T&E + Escrow Only for escrow reports; Trustee Sale Guarantee for TSG; all types for R-14) and the same closing-ratio calculation (Open 4m / Close 4m / Ratio).

Grand totals across the two views are **independent** and do not reconcile to each other — opens and closes are different populations; the closing ratio relates them. The reconciliation bar (revenue) is hidden on Openings views.

Backend: parallel `*Openings()` functions in `lib/reports.js`; routes `/api/reports/<report>/openings`. Frontend: single shared `frontend/components/OpeningsReport.js` rendered per tab via a `viewMode` sub-tab bar in `page.js`. All openings queries exclude test data.

## 13. Repository

- Backend: `/home/claude/manager-reports/`
- Key files:
  - `lib/reports.js` — all report query logic
  - `lib/business-logic.js` — categorization, branch helpers
  - `lib/tessa.js` — AI system prompt
  - `lib/discrepancies.js` — 14 automated checks
  - `lib/daily-email.js` — email composition
  - `lib/softpro-client.js` — SoftPro API integration
  - `server.js` — Express routes
  - `frontend/components/` — React UI components
  - `frontend/app/page.js` — main dashboard layout
  - `database/schema.sql` — table definitions
