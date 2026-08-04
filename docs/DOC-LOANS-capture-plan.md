# DOC + LOANS Capture Plan — for Jerry's Approval

**Status:** DRAFT — plan only. **No code, allowlist, classification, or data has been changed.**
**Author:** Engineering · **Date:** 2026-08-04
**Decision needed:** approve / adjust before any code moves.

---

## 0. One-paragraph summary

The SoftPro API team's deploy now sends two bill codes we previously never received:
**DOC** (Document Prep Fees) and **LOANS** (Loan Tie-In Fees). Both are escrow-side and
100% attributed to an escrow officer. Capturing them lets the doc + tie-in fees finally
reach the **escrow officer commissionable base** (the fees Karla — and everyone — has been
missing). This is deliberately **comp-affecting**: the officer comp base, `escrow_revenue`,
and the company grand total will **rise** by the recovered amount. It must **not** move
title revenue, the PowerBI title-only figure, or the rep commissionable base. The one real
risk is **LOANS is a live partial split, not a migration** — tie-in arrives under *both* ESC
(old) and LOANS (new), and **which code a fee lands under depends on who keyed it in SoftPro,
not a migration date.** So the design makes **no cutover assumption**: we **always look in
both codes**, count each file's tie-in **once**, and for any file that carries tie-in under
**both** ESC and LOANS we **exclude that file's tie-in entirely and flag it** for a human to
resolve (never guess, never double-count, never inflate the dashboard). Plan is
**going-forward-first**; historical backfill is a separate, gated decision (Stage E).

---

## 1. What the mapping found (the basis for this plan)

- **DOC now flows:** July 41 lines / net **$9,550** (39 positive $9,950, **2 negative −$400** correction pair); June 24 lines / **$6,475** (no negatives). 100% carry an escrow officer (Lupe, Anna, Christine, Karla, Joseph).
- **LOANS now flows:** July 15 lines / **$3,250**; June 6 lines / **$1,110**. New dedicated tie-in code.
- **Tie-in is SPLIT, not migrated:** ESC tie-in is still non-zero (July $1,830, June $3,040) *and* LOANS is non-zero — **and today 0 files have tie-in under both codes** (per-file disjoint). This is not guaranteed to stay true: placement is a **human data-entry choice**, so a file *can* end up with both. The design handles that case (exclude-and-flag) rather than assuming it away.
- **ESC tie-in is already counted** in `officer_commissionable_escrow` for every month back to 2025-11 (via the `loan tie`/`tie in` description keywords). LOANS was dropped (not in allowlist).
- **June idempotency check:** raw ESC tie-in ($3,040) == stored ESC tie-in ($3,040) — re-importing does not disturb the ESC portion.
- **Karla's files now correct in the feed:** Spy Glass `20018844` = DOC $400 + LOANS $280 (both previously absent); West Fur `20018248` = DOC $200 + LOANS $280. Her original $4,560 math is now fully present.
- **Endorsements (END/ENDC/ENDW/UEND): still 0** — did NOT land. Out of scope for this plan; flag back to API team if they were expected.

---

## 2. What changes vs. what is protected

### Changes (code + config)
| Area | File / table | Change |
|---|---|---|
| Allowlist | `lib/business-logic.js` `VALID_BILL_CODES` (line ~76) | add `'DOC'`, `'LOANS'` |
| Classification (code) | `lib/business-logic.js` `classifyRevenue()` (lines ~82–97) | map `DOC` and `LOANS` → `'escrow'` |
| Classification (catalog) | `bill_code_classifications` table | set `DOC`, `LOANS` → `classification='revenue'`, `revenue_bucket='escrow'` |
| Officer comp calc | `lib/business-logic.js` `aggregateLineItems()` (lines ~214–258) | include DOC + LOANS in the officer base with net-negatives + cap; count tie-in once per file across ESC+LOANS, **exclude-and-flag** any both-code file |
| Discrepancy check | Discrepancies tab (new check #14) | surface both-code tie-in conflict files + notify Jerry via the daily import-log line |

### Moves (deliberately — the recovery)
- `escrow_revenue` ↑ · `total_revenue` (grand total) ↑ · `officer_commissionable_escrow` ↑
- **Quantified (July, going-forward):** net DOC **$9,550** + net-new LOANS **$3,250** **− any excluded conflict-file tie-in** (today $0, since 0 files carry both codes) = **~$12,800**. (Per-month figure re-computed at run time; see Stage D.)
- **Conflict files (tie-in under both codes):** held out of the officer comp total — never counted, never doubled — until a human resolves the double-entry in SoftPro (see Stage C + the new Discrepancy check).

### MUST NOT move (protected invariants)
- `title_revenue`, `underwriter_revenue` — DOC/LOANS are not TPC/TPW/UPRE.
- **PowerBI title-only (TPC + TPW + UPRE)** — the figure reconciled against Brandon. Untouched.
- **Rep commissionable base** (`commissionable_escrow`) — DOC/LOANS are officer-only (see Stage B rationale).
- Title+escrow+tsg = total reconciliation bar stays green.

---

## 3. Critical finding: allowlist alone is NOT enough

Two independent gates must both change or nothing lands:

1. **Allowlist** (`VALID_BILL_CODES`, business-logic.js:76) — decides whether a line is *kept at import*. DOC/LOANS lines are dropped here today.
2. **Classification** (`classifyRevenue()`, business-logic.js:82) — decides which revenue stream a kept line joins. **Today DOC and LOANS fall through to `default: null`** → even if allowlisted, they'd be stored but add to *no* revenue stream (not escrow, not title) and never reach `escrow_revenue` or the comp base.

**Both must change together.** Allowlist-only = lines stored but invisible to every revenue total. This is spelled out because it's the most likely partial-implementation mistake.

---

## Stage A — Allowlist + classification (going-forward only)

**Change:**
- `VALID_BILL_CODES`: add `'DOC'`, `'LOANS'`.
- `classifyRevenue()`: add `case 'DOC': case 'LOANS': return 'escrow';`
- `bill_code_classifications`: `UPDATE ... SET classification='revenue', revenue_bucket='escrow' WHERE bill_code IN ('DOC','LOANS')`.

**Scope:** current month forward only. No re-import of prior months (that's Stage E).

**Guardrail:** after the change, a dry-run parse of the current month's raw feed must show DOC/LOANS classified as `escrow` and contributing to `escrow_revenue` — with the Stage D reconciliation gate passing — **before** the change is deployed to the live import path.

---

## Stage B — DOC into the officer comp base (net negatives + cap)

**Rationale — officer-only:** the officer base is intentionally *wider* than the rep base
(established in the earlier "officers earn on docs" work). `aggregateLineItems()` already
distinguishes `_commPositive` (rep: settlement + credits) from `_officerCommPositive`
(officer: rep keywords + `loan tie`/`tie in`/`doc`). **DOC belongs to the officer base only.**
The rep base (`_commPositive`, line ~223) is **not** touched.

**Change (business-logic.js `aggregateLineItems`):** DOC lines, once classified `escrow`,
flow through the existing escrow block (lines ~217–235). The description already contains
"Document Prep Fee" → the existing `desc.includes('doc')` officer keyword (line ~231) would
capture positives **if** DOC lines route through the escrow branch. Confirm/route explicitly
rather than rely on the keyword: prefer an explicit `bill_code === 'DOC'` inclusion in the
officer-positive test so capture doesn't depend on description text drifting.

**Net negatives (the −$400 correction pair):** DOC negatives must net, exactly like ESC.
Reuse the existing pattern:
- Negatives accumulate into `order._escrowNegatives` (line ~218–219).
- Final officer value = `_officerCommPositive + _escrowNegatives`, then `Math.min(_, escrow_revenue)` cap, then `Math.max(_, 0)` floor (lines ~250–253).

Because DOC is classified `escrow`, its negatives fall into `_escrowNegatives` automatically
and its positives into `_officerCommPositive` — the existing cap/floor handles the −$400
correction with no new math. **Verify** the two negative July lines net correctly in the
Stage D dry-run.

**Guardrail:** `officer_commissionable_escrow <= escrow_revenue` invariant (the existing
`Math.min` cap) must still hold for every order after DOC is included.

**DOC is unchanged by the LOANS revision below:** DOC has no code-conflict counterpart, so
Stage B stands exactly as written — officer-only, explicit `bill_code === 'DOC'` inclusion,
net negatives, cap. No overlap risk. Nothing in the Stage C revision touches DOC.

---

## Stage C — LOANS into the officer comp base: "look in both, exclude-and-flag on conflict"

**Design decision (Jerry):** make **no cutover assumption.** Whether a tie-in fee lands under
ESC or LOANS depends on **who entered it in SoftPro**, not a migration date — so we **always
check both codes** and count each file's tie-in **once**. We do **not** halt a whole month on
conflict; instead we **exclude-and-flag** the individual conflicting file. This design is
**immune to the migration state** — it works identically whether SoftPro never migrates, fully
migrates, or sits in a permanent split — which is why it is safer than a cutover-based rule.

**Change:** count LOANS as tie-in in the officer base **in addition to** the existing ESC
tie-in. **Do NOT replace ESC tie-in** — both codes are live. LOANS, once classified `escrow`,
routes through the same escrow block; include `bill_code === 'LOANS'` explicitly in the
officer-positive test. ESC tie-in continues via the existing `loan tie`/`tie in` keywords.

**THE PER-FILE RULE (count tie-in once, per file):**
> For each file, look at **both** sources — ESC lines whose description matches tie-in, **and**
> LOANS-coded lines:
> - Tie-in under **ESC only** → **count it.**
> - Tie-in under **LOANS only** → **count it.**
> - Tie-in under **NEITHER** → nothing to count.
> - Tie-in under **BOTH** (conflict) → **EXCLUDE that file's tie-in from the officer comp
>   total entirely.** Count neither ESC nor LOANS. Do **not** guess which is correct. **Flag +
>   notify** (see the new Discrepancy check). The dashboard never inflates.

**Conflict lifecycle (self-healing):** an excluded file stays excluded only while the
double-entry exists. Once a human deletes the wrong entry in SoftPro, the **next import** sees
only one code for that file → it counts normally, no code change, no manual reprocessing.

**Pseudo-logic (illustrative — not code to run now):**
```
for each file in month:
    escTie   = sum(ESC lines where /tie|loan tie/i)      # already-counted source
    loansTie = sum(LOANS lines)                          # new source
    if escTie > 0 and loansTie > 0:
        conflictFiles.add(file)                          # BOTH → exclude + flag + notify
        tieInForFile = 0
    else:
        tieInForFile = escTie + loansTie                 # exactly one source (or zero)
    # tieInForFile feeds the officer-positive base as before; ESC/LOANS never both count
```

Note there is **no month-level HALT.** A conflict removes one file's tie-in and raises a
discrepancy; the rest of the month captures normally.

**Guardrail:** same `officer_commissionable_escrow <= escrow_revenue` cap holds.

---

## Stage C-bis — New Discrepancy check: "Tie-in under both ESC and LOANS"

Add a **14th** automated data-quality check alongside the existing 13, surfaced in the
**Discrepancies tab** where checks #1–13 live.

**Check name:** *Tie-in fee entered under both ESC and LOANS on the same file*

**What it finds:** files in the current month carrying a tie-in line under **ESC-description**
**and** a **LOANS** line — the exact files Stage C excludes.

**Detection query:**
```sql
SELECT
  os.file_number,
  os.escrow_officer,
  ROUND(SUM(rli.sum_amount) FILTER
    (WHERE rli.bill_code='ESC' AND LOWER(rli.charge_description) LIKE '%tie%')::numeric,2) AS esc_tiein,
  ROUND(SUM(rli.sum_amount) FILTER
    (WHERE rli.bill_code='LOANS')::numeric,2) AS loans_tiein
FROM order_summary os
JOIN revenue_line_items rli
  ON rli.file_number = os.file_number AND rli.fetch_month = os.fetch_month
WHERE os.fetch_month = $M
GROUP BY os.file_number, os.escrow_officer
HAVING SUM(rli.sum_amount) FILTER
         (WHERE rli.bill_code='ESC' AND LOWER(rli.charge_description) LIKE '%tie%') > 0
   AND SUM(rli.sum_amount) FILTER (WHERE rli.bill_code='LOANS') > 0;
```

**Displays (in Discrepancies tab):** file number, **both** amounts (`esc_tiein`,
`loans_tiein`), and the **escrow officer** — so it's clear whose comp is affected and by how
much is being held out.

**Notification to Jerry — recommended mechanism (lightest option):** piggyback on the
**existing daily import-log summary Jerry already reviews** — add a one-line entry
(`"⚠ N tie-in double-entry conflict(s) held out — see Discrepancies tab"`) whenever the count
is > 0, and stay silent when it's 0. This adds **no new email, no new SendGrid template, no new
cron** — it rides the report Jerry already opens. (A dedicated SendGrid email via the existing
officer-email transport is available as a heavier fallback if Jerry wants an active push rather
than a passive flag, but the import-log line is the recommended default: lower noise, nothing
new to build or maintain.)

---

## Stage D — Per-month reconciliation gate (the proof)

Run BEFORE and AFTER capture for each processed month; **all six must pass** or the month
is not committed.

**D1 — title untouched (assert identical):**
```sql
SELECT ROUND(SUM(title_revenue + underwriter_revenue)::numeric,2) AS title_uw
FROM order_summary WHERE fetch_month = $M;
-- BEFORE == AFTER, to the cent
```

**D2 — PowerBI title-only untouched (assert identical):**
```sql
SELECT ROUND(SUM(sum_amount)::numeric,2) AS title_only
FROM revenue_line_items
WHERE fetch_month = $M AND bill_code IN ('TPC','TPW','UPRE');
-- BEFORE == AFTER, to the cent
```

**D3 — escrow + grand total rise by EXACTLY the recovery (not a penny more):**
```sql
-- AFTER minus BEFORE:
SELECT ROUND(SUM(escrow_revenue)::numeric,2) AS escrow_rev,
       ROUND(SUM(total_revenue)::numeric,2)  AS grand_total
FROM order_summary WHERE fetch_month = $M;
-- delta(escrow_rev) == delta(grand_total) == (net DOC + net-new LOANS − excluded conflict tie-in)
-- Compute the expected recovery independently:
SELECT
  ROUND(SUM(sum_amount) FILTER (WHERE bill_code='DOC')::numeric,2)   AS net_doc,
  ROUND(SUM(sum_amount) FILTER (WHERE bill_code='LOANS')::numeric,2) AS net_loans
FROM revenue_line_items WHERE fetch_month = $M;  -- (post-capture)
-- Expected delta = net_doc + net_loans − (tie-in dollars on conflict files, held out per D6).
-- With today's 0 conflict files, the excluded term is $0 and delta == net_doc + net_loans exactly.
```

**D4 — reconciliation bar green:**
```sql
SELECT CASE WHEN ABS(SUM(total_revenue)
   - (SUM(title_revenue + underwriter_revenue) + SUM(escrow_revenue) + SUM(tsg_revenue))) < 0.01
   THEN 'RECONCILED' ELSE 'BROKEN' END AS status
FROM order_summary WHERE fetch_month = $M;
```

**D5 — rep base untouched (assert identical):**
```sql
SELECT ROUND(SUM(commissionable_escrow)::numeric,2) AS rep_base
FROM order_summary WHERE fetch_month = $M;
-- BEFORE == AFTER (DOC/LOANS are officer-only)
```

**D6 — conflict files excluded, not doubled (assert exclusion):**
```sql
-- Count the both-code conflict files (same query as the Discrepancy check):
SELECT COUNT(*) AS conflict_files,
       ROUND(SUM(esc_tiein + loans_tiein)::numeric,2) AS excluded_tiein_dollars
FROM (
  SELECT os.file_number,
    SUM(rli.sum_amount) FILTER
      (WHERE rli.bill_code='ESC' AND LOWER(rli.charge_description) LIKE '%tie%') AS esc_tiein,
    SUM(rli.sum_amount) FILTER (WHERE rli.bill_code='LOANS') AS loans_tiein
  FROM order_summary os
  JOIN revenue_line_items rli
    ON rli.file_number = os.file_number AND rli.fetch_month = os.fetch_month
  WHERE os.fetch_month = $M
  GROUP BY os.file_number
  HAVING SUM(rli.sum_amount) FILTER
           (WHERE rli.bill_code='ESC' AND LOWER(rli.charge_description) LIKE '%tie%') > 0
     AND SUM(rli.sum_amount) FILTER (WHERE rli.bill_code='LOANS') > 0
) c;
-- ASSERT: for every conflict file, its tie-in is NOT in the officer comp total
-- (neither ESC nor LOANS counted). And D3's observed delta must equal
-- (net_doc + net_loans − excluded_tiein_dollars) — i.e. the excluded dollars are absent
-- from the rise, proving no double-count and no silent inflation.
-- Today: conflict_files == 0, excluded_tiein_dollars == $0.
```

**Officer base movement (expected to rise — informational, tie to recovery):**
```sql
SELECT escrow_officer, ROUND(SUM(officer_commissionable_escrow)::numeric,2) AS officer_base
FROM order_summary WHERE fetch_month = $M GROUP BY escrow_officer ORDER BY officer_base DESC;
-- AFTER > BEFORE by the per-officer share of net DOC + net-new LOANS
```

---

## Stage E — Historical backfill (SEPARATE, deliberate, gated — NOT part of go-live)

- **Default: do NOT backfill.** Go-live is current month forward only.
- **Prior-month ESC tie-in is already counted** — re-importing must not double it (the ESC
  portion is idempotent, proven for June: raw $3,040 == stored $3,040).
- **Prior-month LOANS was dropped** — backfilling *recovers* it, but that **raises comp for
  CLOSED months officers were already emailed** → comp-sensitive.
- **Requires, before it's even scheduled:**
  1. API team's LOANS cutover answer (informational — historical months may contain both-code
     files; those are handled the same way: excluded-and-flagged per the Stage C rule).
  2. Brandon / Analleli heads-up (closed-month comp rises).
  3. Per-month before/after gate (Stage D, all six checks incl. D6 conflict-exclusion) on each
     backfilled month, one at a time.
- **Framing:** a later decision, not part of this go-live.

---

## 4. Prerequisites before go-live (gates, not code)

1. **API team's LOANS cutover answer is now INFORMATIONAL, not blocking.** The
   "look-in-both + exclude-and-flag" design works regardless of whether SoftPro ever fully
   migrates — because placement is a human data-entry choice, not a date. Whether it's
   ESC-only, LOANS-only, a permanent split, or occasional both-code files, the per-file rule
   counts tie-in once and holds out conflicts. **This is why the design is safer than a
   cutover-based rule: it is immune to the migration state.** The answer is still worth having
   for context, but the capture no longer depends on it.
2. **Brandon / Analleli heads-up** — escrow comp base rises (~$12,800 July). The good kind
   of movement (recovering fees that should always have counted), but comp-affecting.
3. **No hard invariant to satisfy up front** — there is no month-level halt. Conflict files
   (if any appear) are simply held out and flagged in the Discrepancies tab for human
   resolution; the rest of the month captures normally.

---

## 5. Rollback

The capture is **additive + idempotent**, so reversal is clean:
- **Reverse the config:** remove `DOC`/`LOANS` from `VALID_BILL_CODES` and from `classifyRevenue()`;
  reset `bill_code_classifications` for those codes to `unclassified`.
- **Re-import the affected month(s):** the import is delete-then-reinsert per `fetch_month`, so
  a re-import with the reverted allowlist drops DOC/LOANS again and restores the prior
  `escrow_revenue` / `total_revenue` / `officer_commissionable_escrow` exactly.
- **No manual data surgery needed** — because nothing else depends on DOC/LOANS being present,
  and title/rep/PowerBI numbers never moved, rollback touches only the escrow/officer figures
  that the capture raised.
- **Verification after rollback:** re-run Stage D; D3 delta returns to zero (escrow/grand total
  back to pre-capture), D1/D2/D5 unchanged throughout.

---

## 6. Decision requested

- [ ] Approve Stages A–D as **going-forward-first** (current month), with the Stage C
      "look-in-both + exclude-and-flag" rule, the new Discrepancy check (#14, notify via
      import-log line), and the Stage D gate (all six checks incl. D6) mandatory.
- [ ] Stage E (historical backfill) deferred to a separate, explicitly-approved run after the
      API cutover answer + stakeholder heads-up.
- [ ] Or: adjustments (note below).

*Nothing executes until this is approved.*
