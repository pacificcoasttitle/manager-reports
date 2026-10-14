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
