/**
 * Adapters that map a raw Expedia flight-search response (the shape returned by
 * the Expedia MCP `search_flights` tool) into the planner's FlightQuote.
 *
 * This is the exact bridge used by the agent-driven path and by the live demo:
 * run each unique leg through the Expedia tool, then `cheapestExpediaQuote()`
 * the response and hand the quotes to a StaticFlightProvider.
 */

import type { FlightQuote } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Map one Expedia "option" object to a FlightQuote (or null if unpriced). */
export function quoteFromExpediaOption(
  option: any,
  currency = 'USD',
): FlightQuote | null {
  const price = Number(option?.price?.total_price?.value);
  if (!Number.isFinite(price)) return null;
  const slice = option?.slices?.[0] ?? {};
  return {
    price,
    currency: option?.price?.total_price?.currency || currency,
    airline: slice?.ui_text?.operating_info ?? slice?.legs?.[0]?.marketing_airline_name,
    stops: typeof slice?.number_of_stops === 'number' ? slice.number_of_stops : undefined,
    durationLabel: slice?.ui_text?.flight_duration_display ?? slice?.flight_duration,
    departTime: slice?.departure_time,
    arriveTime: slice?.arrival_time,
    seatsLeft: typeof slice?.seats_left === 'number' ? slice.seats_left : null,
    bookingLabel: slice?.ui_text?.departs_arrives,
  };
}

/**
 * Pick the cheapest *bookable* option from a full Expedia search response.
 * Prefers fares with seats remaining; falls back to the absolute cheapest if
 * none report availability.
 */
export function cheapestExpediaQuote(
  response: any,
  currency = 'USD',
): FlightQuote | null {
  const options: any[] = response?.options ?? [];
  const quotes = options
    .map((o) => quoteFromExpediaOption(o, currency))
    .filter((q): q is FlightQuote => q !== null);
  if (!quotes.length) return null;
  const bookable = quotes.filter(
    (q) => q.seatsLeft === null || (q.seatsLeft ?? 0) > 0,
  );
  const pool = bookable.length ? bookable : quotes;
  pool.sort((a, b) => a.price - b.price);
  return pool[0];
}
