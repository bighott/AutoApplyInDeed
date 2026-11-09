/**
 * One-way finder.
 *
 * Unlike the multi-city planner (which models a trip with nights, stops and an
 * optional return), this answers one simple question: from each of several
 * origin airports, what's the cheapest one-way flight to a single destination?
 * It prices origin→destination for each origin (optionally across a few flex
 * days) and returns the best fare per origin, ranked cheapest-first.
 */

import { addDays, type FlightProvider } from './planner';
import type { FlightQuote, LegQuery, SearchOpts } from './types';

export interface OneWaySpec {
  /** Candidate departure airports. */
  origins: string[];
  /** Single arrival airport. */
  destination: string;
  /** Departure date (ISO yyyy-mm-dd). */
  date: string;
  /** Also check this many days AFTER `date` and keep the cheapest (0 = exact date). */
  flexDays?: number;
  adults: number;
  cabin: string;
  currency?: string;
  excludeAirlines?: string[];
}

export interface OneWayOption {
  origin: string;
  /** The date that produced this fare (may differ from spec.date when flexing). */
  date: string;
  quote: FlightQuote;
}

export interface OneWayResult {
  /** Cheapest fare per origin, sorted cheapest-first. */
  options: OneWayOption[];
  /** The single cheapest option overall, or null if nothing priced. */
  best: OneWayOption | null;
  currency: string;
  /** Number of provider lookups performed. */
  queriesRun: number;
  /** Origins that returned no fare from this source. */
  unpriced: string[];
}

/** De-duped, upper-cased origins. */
export function oneWayOrigins(spec: OneWaySpec): string[] {
  return [...new Set(spec.origins.map((o) => String(o).trim().toUpperCase()).filter(Boolean))];
}

/** Dates to try: `date`, then up to `flexDays` days after it. */
export function candidateDates(date: string, flexDays = 0): string[] {
  const out = [date];
  for (let i = 1; i <= Math.max(0, flexDays); i++) out.push(addDays(date, i));
  return out;
}

/** Every leg/date this search will price — used for the billing/budget estimate. */
export function oneWayLegQueries(spec: OneWaySpec): LegQuery[] {
  const dest = String(spec.destination).trim().toUpperCase();
  const dates = candidateDates(spec.date, spec.flexDays ?? 0);
  const out: LegQuery[] = [];
  for (const origin of oneWayOrigins(spec)) {
    for (const date of dates) out.push({ origin, destination: dest, date });
  }
  return out;
}

export async function findOneWay(provider: FlightProvider, spec: OneWaySpec): Promise<OneWayResult> {
  const currency = spec.currency || 'USD';
  const dest = String(spec.destination).trim().toUpperCase();
  const dates = candidateDates(spec.date, spec.flexDays ?? 0);
  const opts: SearchOpts = {
    adults: spec.adults,
    cabin: spec.cabin,
    currency,
    excludeAirlines: spec.excludeAirlines,
  };

  const options: OneWayOption[] = [];
  const unpriced: string[] = [];
  let queriesRun = 0;

  for (const origin of oneWayOrigins(spec)) {
    let best: OneWayOption | null = null;
    for (const date of dates) {
      const quote = await provider.searchCheapest({ origin, destination: dest, date }, opts);
      queriesRun++;
      if (quote && (!best || quote.price < best.quote.price)) best = { origin, date, quote };
    }
    if (best) options.push(best);
    else unpriced.push(origin);
  }

  options.sort((a, b) => a.quote.price - b.quote.price);
  return { options, best: options[0] ?? null, currency, queriesRun, unpriced };
}
