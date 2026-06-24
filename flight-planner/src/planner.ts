/**
 * The planner core: expand per-stop night ranges + flexible start into concrete
 * candidate itineraries, price every unique leg once (deduped + concurrency
 * limited), then pick the cheapest feasible combination of dates.
 */

import type {
  FlightQuote,
  ItineraryResult,
  LegQuery,
  PlanResult,
  PricedLeg,
  SearchOpts,
  TripSpec,
} from './types';

export interface FlightProvider {
  /** Cheapest bookable quote for one leg/date, or null if none found. */
  searchCheapest(query: LegQuery, opts: SearchOpts): Promise<FlightQuote | null>;
  /**
   * Optional: how many of these legs would actually cost a billed API call
   * (i.e. are not already cached). Lets the budget cap count real spend, not
   * gross leg count. Providers without it are treated as "all billable".
   */
  countBillable?(queries: LegQuery[], opts: SearchOpts): number;
}

/** Add `n` days to an ISO yyyy-mm-dd date (UTC, DST-safe). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Stable key for a leg query (used for dedupe + static lookup). */
export function legKey(q: LegQuery): string {
  return `${q.origin}|${q.destination}|${q.date}`;
}

interface ItinerarySkeleton {
  origin: string;
  returnOrigin: string | null;
  startDate: string;
  nightsPerStop: number[];
  legs: LegQuery[];
}

export interface ItineraryEnumeration {
  skeletons: ItinerarySkeleton[];
  /** True if combos/start dates were sampled to stay efficient. */
  sampled: boolean;
  /** Largest start-date step used when sampling (1 = every day). */
  dateStepDays: number;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Count night-combos of [min_i, max_i] with optional sum cap (DP). */
function countRangeCombos(mins: number[], maxes: number[], capSum: number): number {
  const k = mins.length;
  const minSuf = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) minSuf[i] = minSuf[i + 1] + mins[i];
  const memo = new Map<number, number>();
  const rec = (i: number, used: number): number => {
    if (i === k) return 1;
    const key = i * 1_000_003 + used;
    const c = memo.get(key);
    if (c !== undefined) return c;
    const hi = Math.min(maxes[i], capSum === Infinity ? maxes[i] : capSum - used - minSuf[i + 1]);
    let tot = 0;
    for (let n = mins[i]; n <= hi; n++) tot += rec(i + 1, used + n);
    memo.set(key, tot);
    return tot;
  };
  return rec(0, 0);
}

/** Night-combos with optional sum cap, evenly sampled by `stride`, capped at `cap`. */
function rangeCombos(mins: number[], maxes: number[], capSum: number, stride: number, cap: number): number[][] {
  const k = mins.length;
  const minSuf = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) minSuf[i] = minSuf[i + 1] + mins[i];
  const out: number[][] = [];
  const acc: number[] = [];
  let idx = 0;
  const rec = (i: number, used: number): void => {
    if (out.length >= cap) return;
    if (i === k) {
      if (idx % stride === 0) out.push(acc.slice());
      idx++;
      return;
    }
    const hi = Math.min(maxes[i], capSum === Infinity ? maxes[i] : capSum - used - minSuf[i + 1]);
    for (let n = mins[i]; n <= hi; n++) {
      acc.push(n);
      rec(i + 1, used + n);
      acc.pop();
      if (out.length >= cap) return;
    }
  };
  rec(0, 0);
  return out;
}

/** Normalized list of candidate origins (supports single `origin` or `origins[]`). */
export function originsOf(spec: TripSpec): string[] {
  const list = spec.origins && spec.origins.length ? spec.origins : [spec.origin];
  return [...new Set(list.filter(Boolean))]; // de-dupe, keep order
}

/**
 * Build candidate itineraries (origin × start date × night combinations). Stay
 * lengths run from each stop's minNights up to its maxNights — or, when maxNights
 * is omitted and an endDate is set, up to whatever fits the window. Wide windows
 * are sampled (combos + start dates) to stay efficient.
 */
export function enumerateItineraries(spec: TripSpec): ItineraryEnumeration {
  const origins = originsOf(spec);
  const stops = spec.stops;
  const mins = stops.map((s) => Math.max(0, s.minNights));
  const windowDays = spec.endDate ? Math.max(0, daysBetween(spec.startDate, spec.endDate)) : null;
  const maxes = stops.map((s, i) => {
    if (s.maxNights != null) return Math.max(s.maxNights, mins[i]);
    if (windowDays != null) return windowDays;
    return mins[i]; // no max, no window → fixed nights
  });

  const SKELETON_BUDGET = 8000;
  const COMBO_CAP = 800;
  const originPairs = origins.length * (spec.returnToOrigin ? origins.length : 1);
  const flex = Math.max(1, spec.startFlexDays);
  const capSum = windowDays != null ? windowDays : Infinity;

  const comboTotal = countRangeCombos(mins, maxes, capSum);
  const comboStride = comboTotal > COMBO_CAP ? Math.ceil(comboTotal / COMBO_CAP) : 1;
  const combos = rangeCombos(mins, maxes, capSum, comboStride, COMBO_CAP);

  let sampled = comboStride > 1;
  let dateStepDays = 1;
  const out: ItinerarySkeleton[] = [];
  const offPerCombo = Math.max(1, Math.floor(SKELETON_BUDGET / (Math.max(1, combos.length) * Math.max(1, originPairs))));

  for (const nights of combos) {
    const sum = nights.reduce((a, b) => a + b, 0);
    const offMax = windowDays != null ? Math.max(0, windowDays - sum) : flex - 1;
    const step = offMax + 1 > offPerCombo ? Math.ceil((offMax + 1) / offPerCombo) : 1;
    if (step > 1) { sampled = true; dateStepDays = Math.max(dateStepDays, step); }
    for (let off = 0; off <= offMax; off += step) {
      const startDate = addDays(spec.startDate, off);
      for (const departOrigin of origins) {
        const legs: LegQuery[] = [];
        let cursor = startDate;
        let from = departOrigin;
        stops.forEach((stop, i) => {
          legs.push({ origin: from, destination: stop.code, date: cursor });
          cursor = addDays(cursor, nights[i]);
          from = stop.code;
        });
        if (spec.returnToOrigin) {
          for (const returnOrigin of origins) {
            out.push({ origin: departOrigin, returnOrigin, startDate, nightsPerStop: nights, legs: [...legs, { origin: from, destination: returnOrigin, date: cursor }] });
          }
        } else {
          out.push({ origin: departOrigin, returnOrigin: null, startDate, nightsPerStop: nights, legs });
        }
      }
    }
    if (out.length > SKELETON_BUDGET * 2) { sampled = true; break; }
  }
  return { skeletons: out, sampled, dateStepDays };
}

/** Unique leg/date searches needed to price a set of leg-bearing itineraries. */
export function uniqueLegQueries(itineraries: Array<{ legs: LegQuery[] }>): LegQuery[] {
  const map = new Map<string, LegQuery>();
  for (const it of itineraries) {
    for (const leg of it.legs) {
      const k = legKey(leg);
      if (!map.has(k)) map.set(k, leg);
    }
  }
  return [...map.values()];
}

export async function priceWithLimit(
  provider: FlightProvider,
  queries: LegQuery[],
  opts: SearchOpts,
  concurrency: number,
): Promise<Map<string, FlightQuote | null>> {
  const results = new Map<string, FlightQuote | null>();
  let i = 0;
  const worker = async () => {
    while (i < queries.length) {
      const q = queries[i++];
      try {
        results.set(legKey(q), await provider.searchCheapest(q, opts));
      } catch {
        results.set(legKey(q), null);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queries.length)) }, worker),
  );
  return results;
}

export interface PlanOptions {
  /** Parallel provider calls (default 4). */
  concurrency?: number;
  /** Guard against combinatorial blow-up (default 1000 itineraries). */
  maxItineraries?: number;
  /** Budget cap: max billed (uncached) leg lookups allowed (default Infinity). */
  maxSearches?: number;
}

/** Format the over-budget error shared by planner + advisor. */
export function budgetError(billable: number, max: number): Error {
  return new Error(
    `This search would need ${billable} live flight lookups (limit ${max}). ` +
      'Narrow the dates, nights, or places — or use Mock to explore for free. ' +
      'Repeats within the cache window are free.',
  );
}

/**
 * Plan a multi-city, multi-day trip: price the candidate dates and return the
 * cheapest feasible itinerary plus the full per-leg price matrix.
 */
export async function planTrip(
  provider: FlightProvider,
  spec: TripSpec,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const currency = spec.currency || 'USD';
  const { skeletons: itineraries, sampled, dateStepDays } = enumerateItineraries(spec);
  const maxIt = options.maxItineraries ?? 20000;
  if (itineraries.length > maxIt) {
    throw new Error(
      `Too many itinerary combinations (${itineraries.length} > ${maxIt}). ` +
        'Narrow the night ranges, date window, or stops.',
    );
  }

  const queries = uniqueLegQueries(itineraries);
  const searchOpts: SearchOpts = {
    adults: spec.adults,
    cabin: spec.cabin,
    currency,
    excludeAirlines: spec.excludeAirlines,
  };
  const maxSearches = options.maxSearches ?? Infinity;
  const billable = provider.countBillable?.(queries, searchOpts) ?? queries.length;
  if (billable > maxSearches) throw budgetError(billable, maxSearches);
  const priced = await priceWithLimit(provider, queries, searchOpts, options.concurrency ?? 4);

  const legGrid: PricedLeg[] = queries.map((q) => ({
    ...q,
    quote: priced.get(legKey(q)) ?? null,
  }));

  const results: ItineraryResult[] = [];
  for (const it of itineraries) {
    const legs: PricedLeg[] = it.legs.map((q) => ({
      ...q,
      quote: priced.get(legKey(q)) ?? null,
    }));
    // Infeasible if any leg had no flights on its date.
    if (legs.some((l) => !l.quote)) continue;
    const total = legs.reduce((sum, l) => sum + (l.quote as FlightQuote).price, 0);
    // Total flight time is known only if every leg reports a duration.
    const durations = legs.map((l) => (l.quote as FlightQuote).durationMinutes);
    const totalDurationMinutes = durations.every((d) => typeof d === 'number')
      ? (durations as number[]).reduce((a, b) => a + b, 0)
      : null;
    results.push({
      origin: it.origin,
      returnOrigin: it.returnOrigin,
      startDate: it.startDate,
      nightsPerStop: it.nightsPerStop,
      legs,
      total,
      currency,
      totalDurationMinutes,
    });
  }
  results.sort((a, b) => a.total - b.total);

  return {
    best: results[0] ?? null,
    fastest: pickFastest(results),
    bestValue: pickBestValue(results),
    allItineraries: results,
    legGrid,
    queriesRun: queries.length,
    sampled,
    dateStepDays,
  };
}

/** Shortest total flight time among itineraries with known durations. */
export function pickFastest(results: ItineraryResult[]): ItineraryResult | null {
  const timed = results.filter((r) => r.totalDurationMinutes != null);
  if (timed.length === 0) return null;
  return timed.reduce((a, b) =>
    (b.totalDurationMinutes as number) < (a.totalDurationMinutes as number) ? b : a,
  );
}

/**
 * Best price/time trade-off: min-max normalize price and flight time across the
 * timed itineraries to [0,1] and score 60% price / 40% time (lower is better).
 */
export function pickBestValue(
  results: ItineraryResult[],
  priceWeight = 0.6,
): ItineraryResult | null {
  const timed = results.filter((r) => r.totalDurationMinutes != null);
  if (timed.length === 0) return null;
  if (timed.length === 1) return timed[0];

  const prices = timed.map((r) => r.total);
  const times = timed.map((r) => r.totalDurationMinutes as number);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
  const timeWeight = 1 - priceWeight;

  let best = timed[0];
  let bestScore = Infinity;
  for (const r of timed) {
    const score =
      priceWeight * norm(r.total, pMin, pMax) +
      timeWeight * norm(r.totalDurationMinutes as number, tMin, tMax);
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
