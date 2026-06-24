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
  TripSpec,
  TripStop,
} from './types';

export interface FlightProvider {
  /** Cheapest bookable quote for one leg/date, or null if none found. */
  searchCheapest(
    query: LegQuery,
    opts: { adults: number; cabin: string; currency?: string },
  ): Promise<FlightQuote | null>;
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

/** Cartesian product of each stop's [minNights, maxNights] choices. */
function nightCombos(stops: TripStop[]): number[][] {
  let combos: number[][] = [[]];
  for (const s of stops) {
    if (s.maxNights < s.minNights) {
      throw new Error(`Stop ${s.code}: maxNights < minNights`);
    }
    const next: number[][] = [];
    for (const c of combos) {
      for (let n = s.minNights; n <= s.maxNights; n++) next.push([...c, n]);
    }
    combos = next;
  }
  return combos;
}

interface ItinerarySkeleton {
  origin: string;
  returnOrigin: string | null;
  startDate: string;
  nightsPerStop: number[];
  legs: LegQuery[];
}

/** Normalized list of candidate origins (supports single `origin` or `origins[]`). */
export function originsOf(spec: TripSpec): string[] {
  const list = spec.origins && spec.origins.length ? spec.origins : [spec.origin];
  return [...new Set(list.filter(Boolean))]; // de-dupe, keep order
}

/** Build every candidate itinerary (origin × start offset × night combinations). */
export function enumerateItineraries(spec: TripSpec): ItinerarySkeleton[] {
  const out: ItinerarySkeleton[] = [];
  const flex = Math.max(1, spec.startFlexDays);
  const combos = nightCombos(spec.stops);
  const origins = originsOf(spec);
  for (const departOrigin of origins) {
    for (let off = 0; off < flex; off++) {
      const startDate = addDays(spec.startDate, off);
      for (const nights of combos) {
        const baseLegs: LegQuery[] = [];
        let cursor = startDate;
        let from = departOrigin;
        spec.stops.forEach((stop, i) => {
          baseLegs.push({ origin: from, destination: stop.code, date: cursor });
          cursor = addDays(cursor, nights[i]);
          from = stop.code;
        });
        if (spec.returnToOrigin) {
          // Return to ANY origin — try each so an asymmetric round trip (leave
          // from one city, fly home into another) can win on price.
          for (const returnOrigin of origins) {
            out.push({
              origin: departOrigin,
              returnOrigin,
              startDate,
              nightsPerStop: nights,
              legs: [...baseLegs, { origin: from, destination: returnOrigin, date: cursor }],
            });
          }
        } else {
          out.push({
            origin: departOrigin,
            returnOrigin: null,
            startDate,
            nightsPerStop: nights,
            legs: baseLegs,
          });
        }
      }
    }
  }
  return out;
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
  opts: { adults: number; cabin: string; currency?: string },
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
  const itineraries = enumerateItineraries(spec);
  const maxIt = options.maxItineraries ?? 1000;
  if (itineraries.length > maxIt) {
    throw new Error(
      `Too many itinerary combinations (${itineraries.length} > ${maxIt}). ` +
        'Narrow the night ranges or reduce startFlexDays.',
    );
  }

  const queries = uniqueLegQueries(itineraries);
  const priced = await priceWithLimit(
    provider,
    queries,
    { adults: spec.adults, cabin: spec.cabin, currency },
    options.concurrency ?? 4,
  );

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
