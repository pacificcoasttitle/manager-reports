/**
 * Shared email display helpers. Single source of truth so trend math can't
 * drift across the 6 daily emails.
 */

/**
 * Pace-based trend: revenue per working day, current vs prior.
 * Fixes the old partial-current ÷ full-prior bug that produced false mid-month
 * declines (e.g. Orange "−51%" when actually pacing positive). Immune to both
 * partial-month and working-day-count differences.
 *
 * DISPLAY ONLY — computes a label percentage from numbers already in hand.
 * Touches no stored data, no SQL that writes.
 *
 * @param {number} currentMTD            current month-to-date figure
 * @param {number} priorFullMonth        prior month's full-month figure
 * @param {number} workingDaysElapsed    working days elapsed this month
 * @param {number} priorTotalWorkingDays total working days in the prior month
 */
function pctChangePace(currentMTD, priorFullMonth, workingDaysElapsed, priorTotalWorkingDays) {
  if (!priorFullMonth || priorFullMonth === 0 || !workingDaysElapsed || !priorTotalWorkingDays) {
    return { text: '\u2014 vs last month\u2019s pace', color: '#868e96', pct: null };
  }
  const currentPace = currentMTD / workingDaysElapsed;
  const priorPace = priorFullMonth / priorTotalWorkingDays;
  if (priorPace === 0) return { text: '\u2014 vs last month\u2019s pace', color: '#868e96', pct: null };
  const pct = ((currentPace - priorPace) / priorPace) * 100;
  const rounded = parseFloat(pct.toFixed(1));
  return {
    text: `${pct >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(rounded)}% vs last month\u2019s pace`,
    color: pct >= 0 ? '#2f9e44' : '#e03131',
    pct: rounded,
  };
}

module.exports = { pctChangePace };
