'use strict';

/**
 * Budget guardrail. Estimates the cost of an Apify run and refuses to launch a
 * scrape when month-to-date spend + this run would blow past the monthly cap.
 *
 * Cost model per actor:  (per_start) + (expected_results * per_result)
 * Expected results are capped by the actor's configured limit/max_results.
 */

function pricingFor(criteria, actorKey) {
  const p = criteria?.budget?.pricing?.[actorKey];
  if (!p) return { per_result: 0, per_start: 0 };
  return { per_result: Number(p.per_result) || 0, per_start: Number(p.per_start) || 0 };
}

/** Estimate the $ cost of one run of `actorKey` returning ~`expectedResults`. */
function estimateRunCost(criteria, actorKey, expectedResults) {
  const { per_result, per_start } = pricingFor(criteria, actorKey);
  const n = Math.max(0, Number(expectedResults) || 0);
  return round(per_start + n * per_result);
}

/** The configured expected result ceiling for an actor (drives the estimate). */
function expectedResults(criteria, actorKey) {
  const s = criteria?.sources?.[actorKey] || {};
  if (actorKey === 'linkedin') return Number(s.max_results) || 0;
  if (actorKey === 'indeed') return Number(s.limit) || 0;
  if (actorKey === 'ats') return Number(s.limit) || 0;
  return 0;
}

function maxMonthlySpend(criteria) {
  const v = criteria?.budget?.max_monthly_spend;
  return v == null ? 4.5 : Number(v);
}

/**
 * Decide whether a run is affordable.
 * @returns {{ ok: boolean, estimate: number, monthToDate: number, cap: number, projected: number, reason?: string }}
 */
function checkBudget(criteria, store, actorKey) {
  const estimate = estimateRunCost(criteria, actorKey, expectedResults(criteria, actorKey));
  const monthToDate = round(store.monthSpend());
  const cap = maxMonthlySpend(criteria);
  const projected = round(monthToDate + estimate);
  const ok = projected <= cap;
  const result = { ok, estimate, monthToDate, cap, projected };
  if (!ok) {
    result.reason =
      `would spend ~$${estimate.toFixed(4)} on top of $${monthToDate.toFixed(4)} MTD ` +
      `= $${projected.toFixed(4)}, over the $${cap.toFixed(2)} monthly cap`;
  }
  return result;
}

/** Actual cost of a completed run, given how many results actually came back. */
function actualRunCost(criteria, actorKey, actualResults) {
  return estimateRunCost(criteria, actorKey, actualResults);
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

module.exports = {
  estimateRunCost,
  expectedResults,
  maxMonthlySpend,
  checkBudget,
  actualRunCost,
  pricingFor,
};
