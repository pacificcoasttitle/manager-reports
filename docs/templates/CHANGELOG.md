# Daily Report template changes

## 2026-10-08 — Glendale linkage and blank-slot repair

- Repointed `pro!E17/F17`, `K17/L17`, and `Q17` from Joseph's subtotal
  (`Escrow` row 25) to `Total Glendale Escrow` (row 48). `pro!R17`
  already referenced row 48 and was unchanged.
- Normalized `Escrow!D25`, `H25:J25`, and `L25:N25` to sum rows 20:24,
  matching the existing month/prior ranges and preventing inconsistent
  officer coverage.
- Cleared legacy input formulas from unused `r14` cells `AA56`, `S82`,
  and `AD82`. The latter two had contributed one closing and $450 of
  revenue from a blank row after Excel recalculation.
- Restored `r14!B82` as the Orange-section `Other County Reps` slot.

No rows were inserted or deleted. No other `pro` formulas were changed.

## 2026-10-14 — Reconciliation repairs

- Restored missing `r14` rep formulas: `M28`, `M51`, `N51`, `M53`, and
  `N53`. A scan of every rep row found no other missing total or projection
  formulas.
- Corrected `r14!H62` from `SUM(F62:G62)` to `SUM(E62:G62)` so Sonia
  Flores's Purchase openings are included in her Today total.
- Corrected `pro!R47` from
  `SUM(R17,R22:R23,R23,R30,R41,R44)` to
  `SUM(R17,R22:R23,R30,R41,R44)`, removing the duplicate `R23` reference.
- Converted the Southern California and Total Company Prior cells
  `pro!I51/O51/T51/U51/AB51` and `pro!I53/O53/T53/U53/AB53` to component-sum
  formulas so Prior follows the same convention as Day and MTD.
- Added the missing internal comparison formulas in
  `pro!I56/L56/O56/T56/U56/AB56` and the missing `pro`-to-`r14` comparison
  formulas in `pro!E59/F59/I59/O59/T59/U59`.
- Cleared unreferenced legacy workpaper formulas from `r14!V107` and
  `r14!AB107`. Rows 120:127 were confirmed not to feed a total and were left
  unchanged.
- Cleared stale `#REF!` values exposed by a full Excel recalculation in
  `Escrow!BL6`, `Escrow!BO6`, and `Escrow!BR6`.

No rows were inserted or deleted.

## 2026-11-01 — Zero-elapsed projection guards

- Wrapped every `pro` formula that directly references elapsed/total working-day
  drivers (`$O$1` / `$Q$1`) in `IF($O$1=0,0,<original formula>)`. The 148
  guarded cells are:
  - Row 6: `G6`, `H6`, `M6`, `N6`, `S6`, `T6`, `AE6`, `AH6`, `AK6`,
    `AN6`, `AQ6`, `AT6`, `AW6`, `AZ6`, `BB6`, `BH6`, `BW6`, `BZ6`,
    `CU6`, `DG6`, `DM6`.
  - Row 8: `G8`, `H8`, `M8`, `N8`, `S8`.
  - Rows 9:13: columns `G`, `H`, `M`, `N`, `S` on every row.
  - Row 16: `M16`, `N16`.
  - Rows 17:19: columns `G`, `H`, `M`, `N`, `S` on every row.
  - Rows 22:23: columns `G`, `H`, `M`, `N`, `S` on every row.
  - Row 26: `G26`, `H26`, `K26`, `M26`, `N26`, `S26`.
  - Row 27: `G27`, `H27`, `M27`, `N27`, `S27`.
  - Rows 30:32: columns `G`, `H`, `M`, `N`, `S` on every row.
  - Row 35: `G35`, `H35`, `K35`, `M35`, `N35`, `S35`.
  - Rows 36:38: columns `G`, `H`, `M`, `N`, `S` on every row.
  - Row 41: `G41`, `H41`, `M41`, `S41`.
  - Row 44: `G44`, `H44`, `M44`, `S44`.
  - Rows 48:50: columns `G`, `H`, `M`, `N`, `S` on every row.
- Wrapped every `r14` projection formula that references `$P$1` / `$R$1` in
  `IF($P$1=0,0,<original formula>)`. The 89 guarded cells are `N9:N45`,
  `N48:N83`, `N87:N92`, `N94:N101`, and `N134:N135`.
- A real Excel recalculation of the zero-activity workbook exposed 53 additional
  `pro` ratio formulas whose MTD count divisor can also be zero. Each was
  wrapped with its actual divisor, never `IFERROR`, so unrelated errors remain
  visible:
  - Revenue-per-close cells: `W6`, `W8:W14`, `W17:W20`, `W22:W23`,
    `W26:W28`, `W30:W33`, `W35:W36`, `W38:W39`, `W41`, `W47:W51`,
    `W53`, and `W57`. Each guard names the denominator already present in
    the formula (`L` on the corresponding row, except `W22`, which names
    its original `M16` divisor).
  - Closing-ratio cells: `Z6`, `AA6`, `Z8:AA14`, `Z24:AA24`, and
    `Z28:AA28`. Each guard names the original `Y`-column divisor.
- The expressions inside each guard are unchanged. No formula without one of
  the documented zero-capable elapsed/count divisors was edited.

No rows were inserted or deleted. Formula counts are unchanged.

## 2026-10-28 — Other County Reps TSG revenue repair

- Corrected `r14!AE82` from `SUM(AB82:AC82)` to `SUM(AB82:AD82)` so TSG
  revenue routed to the Orange-section `Other County Reps` slot reaches the
  row total, section total, `pro`, and the Math check.
- Repointed `pro!E38/F38/K38/L38/Q38/R38` from the Orange-only TSG subtotal
  (`r14` row 84) to the sum of the Glendale and Orange TSG subtotals
  (`r14` rows 46 and 84), so `pro` includes companywide TSG production.

No rows were inserted or deleted.
