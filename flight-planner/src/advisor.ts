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
  /** Latest possible return (ISO). If set and later than startDate+totalNights, the trip slides within the window. */
  latestReturn?: string;
  /** Total nights for the whole trip. */
  totalNights: number;
  returnToOrigin: boolean;
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

export interface AdvisorEnumeration {
  skeletons: AdvisorSkeleton[];
  /** True if the date/length grid was sampled (coarsened) to stay within budget. */
  sampled: boolean;
  /** Days between sampled start dates (1 = every day). */
  dateStepDays: number;
}

/**
 * Enumerate candidate routes (order × split × start offset × origin pair),
 * auto-coarsening the date/length grid so the count stays under `maxRoutes`.
 * Every city ORDER and origin pairing is always tried in full; only the date
 * offsets and (if still needed) the day-splits are sampled.
 */
export function enumerateAdvisor(spec: AdvisorSpec, maxRoutes: number): AdvisorEnumeration {
  const origins = [...new Set(spec.origins.filter(Boolean))];
  const dests = spec.destinations;
  const perms = permute(dests);
  const total = spec.totalNights;

  const slack = spec.latestReturn
    ? Math.max(0, daysBetween(spec.startDate, spec.latestReturn) - total)
    : 0;

  const originPairs = spec.returnToOrigin ? origins.length * origins.length : origins.length;
  // The irreducible part — every order × origin pairing — can't be sampled away.
  if (perms.length * originPairs > maxRoutes) {
    throw new Error(
      'Too many origin × place-order combinations to search. ' +
        'Reduce the number of places or origin airports.',
    );
  }

  // Splits-per-perm count is permutation-invariant; compute once.
  const mins0 = perms[0].map((d) => Math.max(1, d.minNights ?? 1));
  const maxs0 = perms[0].map((d) => Math.min(d.maxNights ?? total, total));
  const splitsCount = countSplits(mins0, maxs0, total);

  // Budget per (perm × origin pair) = how many (offset × split) we can afford.
  const perBranch = Math.max(1, Math.floor(maxRoutes / (perms.length * originPairs)));
  let step: number;
  let splitStride: number;
  let splitCap: number;
  if (splitsCount <= perBranch) {
    splitStride = 1;
    splitCap = Infinity;
    const maxOffsets = Math.max(1, Math.floor(perBranch / splitsCount));
    step = Math.max(1, Math.ceil((slack + 1) / maxOffsets));
  } else {
    step = slack + 1; // only the earliest start date
    splitCap = perBranch;
    splitStride = Math.max(1, Math.ceil(splitsCount / perBranch));
  }
  const offsets: number[] = [];
  for (let o = 0; o <= slack; o += step) offsets.push(o);
  const sampled = step > 1 || splitCap < splitsCount;

  const out: AdvisorSkeleton[] = [];
  for (const perm of perms) {
    const mins = perm.map((d) => Math.max(1, d.minNights ?? 1));
    const maxs = perm.map((d) => Math.min(d.maxNights ?? total, total));
    const order = perm.map((d) => d.code);
    for (const split of nightSplits(mins, maxs, total, splitStride, splitCap)) {
      for (const off of offsets) {
        const startDate = addDays(spec.startDate, off);
        for (const depart of origins) {
          const returns = spec.returnToOrigin ? origins : [null];
          for (const ret of returns) {
            const legs: LegQuery[] = [];
            let cursor = startDate;
            let from = depart;
            perm.forEach((d, i) => {
              legs.push({ origin: from, destination: d.code, date: cursor });
              cursor = addDays(cursor, split[i]);
              from = d.code;
            });
            if (ret) legs.push({ origin: from, destination: ret, date: cursor });
            out.push({ origin: depart, returnOrigin: ret, startDate, nightsPerStop: split, order, legs });
          }
        }
      }
    }
  }
  return { skeletons: out, sampled, dateStepDays: step };
}

export async function planAdvisor(
  provider: FlightProvider,
  spec: AdvisorSpec,
  options: AdvisorOptions = {},
): Promise<AdvisorResult> {
  const currency = spec.currency || 'USD';
  const maxDest = options.maxDestinations ?? 6;
  if (spec.destinations.length < 1) throw new Error('Add at least one place to visit.');
  if (spec.destinations.length > maxDest) {
    throw new Error(`Too many destinations (${spec.destinations.length} > ${maxDest}).`);
  }
  if (spec.totalNights < spec.destinations.length) {
    throw new Error(
      `Total nights (${spec.totalNights}) must be at least the number of places ` +
        `(${spec.destinations.length}) so each gets at least one night.`,
    );
  }

  const { skeletons, sampled, dateStepDays } = enumerateAdvisor(spec, options.maxRoutes ?? 80000);
  const queries = uniqueLegQueries(skeletons);
  const searchOpts = { adults: spec.adults, cabin: spec.cabin, currency };
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
    routesConsidered: skeletons.length,
    sampled,
    dateStepDays,
  };
}
