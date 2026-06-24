/**
 * "Plan my trip" advisor: route optimization.
 *
 * Unlike the fixed-order planner, here the user gives an *unordered* set of
 * places plus a total trip length and a date window, and the advisor discovers
 * the best route: it tries every visit ORDER (permutation), every way to split
 * the total nights across the cities (respecting per-city min/max), every start
 * date that fits the window, and every depart/return origin pairing — then
 * prices the unique legs once and returns the cheapest / fastest / best-value
 * routes.
 */

import {
  addDays,
  budgetError,
  pickBestValue,
  pickFastest,
  priceWithLimit,
  uniqueLegQueries,
  legKey,
  type FlightProvider,
} from './planner';
import { coordsOf, haversineKm } from './airports';
import type { FlightQuote, ItineraryResult, LegQuery, PricedLeg } from './types';

export interface AdvisorDestination {
  code: string;
  label?: string;
  /** Per-city night bounds; default min 1, max = totalNights. */
  minNights?: number;
  maxNights?: number;
}

export interface AdvisorSpec {
  /** Candidate depart/return airports. */
  origins: string[];
  /** Unordered places to visit. */
  destinations: AdvisorDestination[];
  /** Earliest possible departure (ISO yyyy-mm-dd). */
  startDate: string;
  /** Latest possible return (ISO). The trip slides within [startDate, endDate]. */
  endDate?: string;
  /**
   * Total nights for the whole trip (DATES mode). Omit for MONTH/window mode,
   * where stay lengths come from each city's min/max within [startDate, endDate].
   */
  totalNights?: number;
  returnToOrigin: boolean;
  /** Prune geographically inefficient city orders before pricing (default true). */
  optimizeGeography?: boolean;
  /** IATA airline codes to exclude from results (optional). */
  excludeAirlines?: string[];
  adults: number;
  cabin: string;
  currency?: string;
}

export interface AdvisorResult {
  best: ItineraryResult | null;
  fastest: ItineraryResult | null;
  bestValue: ItineraryResult | null;
  allItineraries: ItineraryResult[];
  queriesRun: number;
  permutationsTried: number;
  /** City orders actually priced after geographic pruning. */
  ordersPriced: number;
  /** Total candidate routes enumerated before pricing. */
  routesConsidered: number;
  /** True if the date/length grid was sampled to stay efficient. */
  sampled: boolean;
  /** Days between sampled start dates (1 = every day). */
  dateStepDays: number;
}

export interface AdvisorOptions {
  concurrency?: number;
  /**
   * Guard against combinatorial blow-up in route ENUMERATION (in-memory only;
   * pricing is deduped to unique legs). Default 80000.
   */
  maxRoutes?: number;
  /** Hard cap on destinations (perms = k!); default 6. */
  maxDestinations?: number;
  /** How many ranked itineraries to return (keeps the payload small). Default 50. */
  maxResults?: number;
  /** Budget cap: max billed (uncached) leg lookups allowed (default Infinity). */
  maxSearches?: number;
}

interface AdvisorSkeleton {
  origin: string;
  returnOrigin: string | null;
  startDate: string;
  nightsPerStop: number[];
  order: string[];
  legs: LegQuery[];
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function permute<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  arr.forEach((v, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permute(rest)) out.push([v, ...p]);
  });
  return out;
}

/** Count valid night-splits (permutation-invariant) via DP, without listing them. */
function countSplits(mins: number[], maxs: number[], total: number): number {
  const k = mins.length;
  const memo = new Map<number, number>();
  const rec = (i: number, rem: number): number => {
    if (i === k) return rem === 0 ? 1 : 0;
    if (rem < 0) return 0;
    const key = i * 1_000_003 + rem;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let c = 0;
    for (let n = mins[i]; n <= maxs[i] && n <= rem; n++) c += rec(i + 1, rem - n);
    memo.set(key, c);
    return c;
  };
  return rec(0, total);
}

/**
 * Night-splits within [mins[i], maxs[i]] summing to `total`. `stride` keeps only
 * every Nth split (even sampling) and `cap` stops early — together they bound the
 * output when the full set would be too large.
 */
function nightSplits(
  mins: number[],
  maxs: number[],
  total: number,
  stride = 1,
  cap = Infinity,
): number[][] {
  const k = mins.length;
  const minSuffix = new Array(k + 1).fill(0);
  const maxSuffix = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    minSuffix[i] = minSuffix[i + 1] + mins[i];
    maxSuffix[i] = maxSuffix[i + 1] + maxs[i];
  }
  const out: number[][] = [];
  const acc: number[] = [];
  let idx = 0;
  const rec = (i: number, remaining: number): void => {
    if (out.length >= cap) return;
    if (i === k) {
      if (remaining === 0) {
        if (idx % stride === 0) out.push(acc.slice());
        idx++;
      }
      return;
    }
    const lo = Math.max(mins[i], remaining - maxSuffix[i + 1]);
    const hi = Math.min(maxs[i], remaining - minSuffix[i + 1]);
    for (let n = lo; n <= hi; n++) {
      acc.push(n);
      rec(i + 1, remaining - n);
      acc.pop();
      if (out.length >= cap) return;
    }
  };
  rec(0, total);
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** Count night-combos of [min_i, max_i] with sum ≤ cap (DP) — for window mode. */
function countRangeCombos(mins: number[], maxs: number[], cap: number): number {
  const k = mins.length;
  const minSuf = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) minSuf[i] = minSuf[i + 1] + mins[i];
  const memo = new Map<number, number>();
  const rec = (i: number, used: number): number => {
    if (i === k) return 1;
    const key = i * 1_000_003 + used;
    const c = memo.get(key);
    if (c !== undefined) return c;
    const hi = Math.min(maxs[i], cap - used - minSuf[i + 1]);
    let tot = 0;
    for (let n = mins[i]; n <= hi; n++) tot += rec(i + 1, used + n);
    memo.set(key, tot);
    return tot;
  };
  return rec(0, 0);
}

/** Night-combos with sum ≤ cap, evenly sampled by `stride`, capped at `cap2`. */
function rangeCombos(mins: number[], maxs: number[], cap: number, stride: number, cap2: number): number[][] {
  const k = mins.length;
  const minSuf = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) minSuf[i] = minSuf[i + 1] + mins[i];
  const out: number[][] = [];
  const acc: number[] = [];
  let idx = 0;
  const rec = (i: number, used: number): void => {
    if (out.length >= cap2) return;
    if (i === k) {
      if (idx % stride === 0) out.push(acc.slice());
      idx++;
      return;
    }
    const hi = Math.min(maxs[i], cap - used - minSuf[i + 1]);
    for (let n = mins[i]; n <= hi; n++) {
      acc.push(n);
      rec(i + 1, used + n);
      acc.pop();
      if (out.length >= cap2) return;
    }
  };
  rec(0, 0);
  return out;
}

export interface AdvisorEnumeration {
  skeletons: AdvisorSkeleton[];
  /** True if the date/length grid was sampled (coarsened) to stay within budget. */
  sampled: boolean;
  /** Days between sampled start dates (1 = every day). */
  dateStepDays: number;
  /** All possible city orders (k!). */
  ordersConsidered: number;
  /** City orders actually priced after geographic pruning. */
  ordersPriced: number;
}

/**
 * Geographic route cost (km): origin → cities → origin, using the nearest origin
 * for each end. Used to keep only sensible city orders instead of pricing every
 * permutation — improves routing and cuts searches.
 */
function geoCost(perm: AdvisorDestination[], origins: string[]): number {
  let s = 0;
  for (let i = 0; i < perm.length - 1; i++) {
    s += haversineKm(coordsOf(perm[i].code)!, coordsOf(perm[i + 1].code)!);
  }
  const oc = origins.map(coordsOf).filter((c): c is [number, number] => !!c);
  if (oc.length) {
    s += Math.min(...oc.map((o) => haversineKm(o, coordsOf(perm[0].code)!)));
    s += Math.min(...oc.map((o) => haversineKm(coordsOf(perm[perm.length - 1].code)!, o)));
  }
  return s;
}

/** Pick the geographically sensible city orders (within 25% of the best, capped). */
function selectOrders(
  allPerms: AdvisorDestination[][],
  origins: string[],
  enabled: boolean,
): AdvisorDestination[][] {
  const haveCoords = allPerms[0].every((d) => coordsOf(d.code));
  if (!enabled || !haveCoords || allPerms[0].length < 3) return allPerms;
  const scored = allPerms
    .map((p) => ({ p, c: geoCost(p, origins) }))
    .sort((a, b) => a.c - b.c);
  const best = scored[0].c;
  const kept = scored.filter((s) => s.c <= best * 1.25).slice(0, 8).map((s) => s.p);
  return kept.length ? kept : [scored[0].p];
}

/**
 * Enumerate candidate routes (order × split × start offset × origin pair),
 * auto-coarsening the date/length grid so the count stays under `maxRoutes`.
 * Every city ORDER and origin pairing is always tried in full; only the date
 * offsets and (if still needed) the day-splits are sampled.
 */
export function enumerateAdvisor(spec: AdvisorSpec, maxRoutes: number): AdvisorEnumeration {
  const origins = [...new Set(spec.origins.filter(Boolean))];
  const allPerms = permute(spec.destinations);
  const perms = selectOrders(allPerms, origins, spec.optimizeGeography !== false);

  // DATES mode: fixed totalNights. MONTH/window mode: stays come from per-city
  // ranges within [startDate, endDate].
  const total = typeof spec.totalNights === 'number' && spec.totalNights > 0 ? spec.totalNights : null;
  const windowDays = spec.endDate ? Math.max(0, daysBetween(spec.startDate, spec.endDate)) : null;

  const originPairs = spec.returnToOrigin ? origins.length * origins.length : origins.length;
  if (perms.length * originPairs > maxRoutes) {
    throw new Error(
      'Too many origin × place-order combinations to search. ' +
        'Reduce the number of places or origin airports.',
    );
  }

  // Per (perm × origin pair) budget for (combos × start offsets).
  const perBranch = Math.max(1, Math.floor(maxRoutes / (perms.length * originPairs)));
  const COMBO_CAP = Math.max(1, Math.min(400, perBranch));

  let sampled = false;
  let dateStepDays = 1;
  const out: AdvisorSkeleton[] = [];

  for (const perm of perms) {
    const mins = perm.map((d) => Math.max(1, d.minNights ?? 1));
    const order = perm.map((d) => d.code);

    let combos: number[][];
    if (total != null) {
      const maxs = perm.map((d) => Math.min(d.maxNights ?? total, total));
      const cnt = countSplits(mins, maxs, total);
      const stride = cnt > COMBO_CAP ? Math.ceil(cnt / COMBO_CAP) : 1;
      if (stride > 1) sampled = true;
      combos = nightSplits(mins, maxs, total, stride, COMBO_CAP);
    } else if (windowDays != null) {
      const maxs = perm.map((d) => Math.min(d.maxNights ?? windowDays, windowDays));
      const cnt = countRangeCombos(mins, maxs, windowDays);
      const stride = cnt > COMBO_CAP ? Math.ceil(cnt / COMBO_CAP) : 1;
      if (stride > 1) sampled = true;
      combos = rangeCombos(mins, maxs, windowDays, stride, COMBO_CAP);
    } else {
      combos = [mins]; // no total, no window → minimum stays, fixed start
    }

    const offPerCombo = Math.max(1, Math.floor(perBranch / Math.max(1, combos.length)));
    for (const nights of combos) {
      const sum = nights.reduce((a, b) => a + b, 0);
      const offMax = windowDays != null ? Math.max(0, windowDays - sum) : 0;
      const step = offMax + 1 > offPerCombo ? Math.ceil((offMax + 1) / offPerCombo) : 1;
      if (step > 1) { sampled = true; dateStepDays = Math.max(dateStepDays, step); }
      for (let off = 0; off <= offMax; off += step) {
        const startDate = addDays(spec.startDate, off);
        for (const depart of origins) {
          const returns = spec.returnToOrigin ? origins : [null];
          for (const ret of returns) {
            const legs: LegQuery[] = [];
            let cursor = startDate;
            let from = depart;
            perm.forEach((d, i) => {
              legs.push({ origin: from, destination: d.code, date: cursor });
              cursor = addDays(cursor, nights[i]);
              from = d.code;
            });
            if (ret) legs.push({ origin: from, destination: ret, date: cursor });
            out.push({ origin: depart, returnOrigin: ret, startDate, nightsPerStop: nights, order, legs });
          }
        }
      }
    }
    if (out.length > maxRoutes * 2) { sampled = true; break; }
  }
  return {
    skeletons: out,
    sampled,
    dateStepDays,
    ordersConsidered: allPerms.length,
    ordersPriced: perms.length,
  };
}

export async function planAdvisor(
  provider: FlightProvider,
  spec: AdvisorSpec,
  options: AdvisorOptions = {},
): Promise<AdvisorResult> {
  const currency = spec.currency || 'USD';
  const maxDest = options.maxDestinations ?? 6;
  const k = spec.destinations.length;
  if (k < 1) throw new Error('Add at least one place to visit.');
  if (k > maxDest) throw new Error(`Too many destinations (${k} > ${maxDest}).`);

  const minTotal = spec.destinations.reduce((s, d) => s + Math.max(1, d.minNights ?? 1), 0);
  const total = typeof spec.totalNights === 'number' && spec.totalNights > 0 ? spec.totalNights : null;
  const windowDays = spec.endDate
    ? Math.round((Date.parse(`${spec.endDate}T00:00:00Z`) - Date.parse(`${spec.startDate}T00:00:00Z`)) / 86_400_000)
    : null;

  if (total != null) {
    // DATES mode
    if (total < minTotal) {
      throw new Error(`Total nights (${total}) is less than the minimum stays you set (${minTotal}). Raise total nights or lower minimums.`);
    }
    if (windowDays != null && windowDays < total) {
      throw new Error(`The date window (${windowDays} days) is shorter than the total nights (${total}). Widen the dates or lower total nights.`);
    }
  } else if (windowDays != null) {
    // MONTH/window mode
    if (windowDays < minTotal) {
      throw new Error(`The minimum stays (${minTotal} nights) don't fit in the chosen window (${windowDays} days). Lower minimums or pick a longer window.`);
    }
  } else {
    throw new Error('Set total nights (with dates), or pick a whole month, so we know how long the trip is.');
  }

  const { skeletons, sampled, dateStepDays, ordersPriced } = enumerateAdvisor(
    spec,
    options.maxRoutes ?? 80000,
  );
  const queries = uniqueLegQueries(skeletons);
  const searchOpts = {
    adults: spec.adults,
    cabin: spec.cabin,
    currency,
    excludeAirlines: spec.excludeAirlines,
  };
  const maxSearches = options.maxSearches ?? Infinity;
  const billable = provider.countBillable?.(queries, searchOpts) ?? queries.length;
  if (billable > maxSearches) throw budgetError(billable, maxSearches);
  const priced = await priceWithLimit(provider, queries, searchOpts, options.concurrency ?? 6);

  const results: ItineraryResult[] = [];
  for (const sk of skeletons) {
    const legs: PricedLeg[] = sk.legs.map((q) => ({ ...q, quote: priced.get(legKey(q)) ?? null }));
    if (legs.some((l) => !l.quote)) continue;
    const total = legs.reduce((s, l) => s + (l.quote as FlightQuote).price, 0);
    const durations = legs.map((l) => (l.quote as FlightQuote).durationMinutes);
    const totalDurationMinutes = durations.every((d) => typeof d === 'number')
      ? (durations as number[]).reduce((a, b) => a + b, 0)
      : null;
    results.push({
      origin: sk.origin,
      returnOrigin: sk.returnOrigin,
      startDate: sk.startDate,
      nightsPerStop: sk.nightsPerStop,
      order: sk.order,
      legs,
      total,
      currency,
      totalDurationMinutes,
    });
  }
  results.sort((a, b) => a.total - b.total);

  // Compute picks over ALL feasible routes, but only return the top N so the
  // JSON payload stays small (mock can make tens of thousands feasible).
  const best = results[0] ?? null;
  const fastest = pickFastest(results);
  const bestValue = pickBestValue(results);
  return {
    best,
    fastest,
    bestValue,
    allItineraries: results.slice(0, options.maxResults ?? 50),
    queriesRun: queries.length,
    permutationsTried: factorial(spec.destinations.length),
    ordersPriced,
    routesConsidered: skeletons.length,
    sampled,
    dateStepDays,
  };
}
