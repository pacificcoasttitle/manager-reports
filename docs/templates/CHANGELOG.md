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
