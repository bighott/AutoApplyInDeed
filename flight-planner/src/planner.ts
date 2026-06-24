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
  startDate: string;
  nightsPerStop: number[];
  legs: LegQuery[];
}

/** Build every candidate itinerary (start offset × night combinations). */
export function enumerateItineraries(spec: TripSpec): ItinerarySkeleton[] {
  const out: ItinerarySkeleton[] = [];
  const flex = Math.max(1, spec.startFlexDays);
  const combos = nightCombos(spec.stops);
  for (let off = 0; off < flex; off++) {
    const startDate = addDays(spec.startDate, off);
    for (const nights of combos) {
      const legs: LegQuery[] = [];
      let cursor = startDate;
      let from = spec.origin;
      spec.stops.forEach((stop, i) => {
        legs.push({ origin: from, destination: stop.code, date: cursor });
        cursor = addDays(cursor, nights[i]);
        from = stop.code;
      });
      if (spec.returnToOrigin) {
        legs.push({ origin: from, destination: spec.origin, date: cursor });
      }
      out.push({ startDate, nightsPerStop: nights, legs });
    }
  }
  return out;
}

/** The unique set of leg/date searches needed to price all itineraries. */
export function uniqueLegQueries(itineraries: ItinerarySkeleton[]): LegQuery[] {
  const map = new Map<string, LegQuery>();
  for (const it of itineraries) {
    for (const leg of it.legs) {
      const k = legKey(leg);
      if (!map.has(k)) map.set(k, leg);
    }
  }
  return [...map.values()];
}

async function priceWithLimit(
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
    results.push({
      startDate: it.startDate,
      nightsPerStop: it.nightsPerStop,
      legs,
      total,
      currency,
    });
  }
  results.sort((a, b) => a.total - b.total);

  return {
    best: results[0] ?? null,
    allItineraries: results,
    legGrid,
    queriesRun: queries.length,
  };
}
