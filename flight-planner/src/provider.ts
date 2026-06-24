/**
 * Flight provider abstraction.
 *
 * The planner is provider-agnostic: anything that can return the cheapest quote
 * for an (origin, destination, date) leg satisfies the interface. Three concrete
 * providers ship here:
 *   - MockFlightProvider   — deterministic offline pricing (tests/demos).
 *   - StaticFlightProvider — serves quotes from a precomputed map. This is the
 *     bridge for the *agent-driven Expedia* path: the agent enumerates the
 *     unique legs, runs each through the Expedia MCP flight-search tool, maps
 *     each response with adapters.cheapestExpediaQuote(), and feeds the map in.
 *   - HttpFlightProvider   — template for a real keyed flight API (Duffel,
 *     Amadeus, Kiwi/Tequila, etc.) you call from your own backend.
 */

import type { FlightProvider } from './planner';
import { legKey } from './planner';
import { airlineCodesFromLabel } from './airlines';
import type { FlightQuote, LegQuery, SearchOpts } from './types';
import { googleFlightsUrl, minutesToLabel } from './util';

const MOCK_AIRLINES: Array<[string, string]> = [
  ['AA', 'American'], ['DL', 'Delta'], ['UA', 'United'],
  ['BA', 'British Airways'], ['AF', 'Air France'], ['LH', 'Lufthansa'],
];

// --- deterministic mock (offline) --------------------------------------------

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export class MockFlightProvider implements FlightProvider {
  async searchCheapest(q: LegQuery, opts: SearchOpts): Promise<FlightQuote | null> {
    const routeBase = 80 + (hash(q.origin + q.destination) % 420);
    // Per-date variation makes some days cheaper — that's what the planner hunts.
    const dateVar = (hash(q.date) % 7) * 22;
    const cabinMult =
      opts.cabin === 'FIRST'
        ? 5
        : opts.cabin === 'BUSINESS'
          ? 3
          : opts.cabin === 'PREMIUMECONOMY'
            ? 1.6
            : 1;
    const price = Math.round((routeBase + dateVar) * cabinMult * opts.adults);
    const stops = dateVar > 90 ? 1 : 0;
    // Duration varies by route + date so "fastest" and "cheapest" can differ.
    const durationMinutes = 300 + (hash(q.origin + q.destination) % 360) + stops * 120 + (hash(q.date) % 50);

    // Pick a real-ish airline (deterministic); skip any the user excluded.
    const exclude = new Set((opts.excludeAirlines ?? []).map((c) => c.toUpperCase()));
    let idx = hash(q.origin + q.destination + 'air') % MOCK_AIRLINES.length;
    for (let n = 0; n < MOCK_AIRLINES.length && exclude.has(MOCK_AIRLINES[idx][0]); n++) {
      idx = (idx + 1) % MOCK_AIRLINES.length;
    }
    if (exclude.has(MOCK_AIRLINES[idx][0])) return null; // every airline excluded
    const [code, name] = MOCK_AIRLINES[idx];
    const flightNumber = `${code}${100 + (hash(q.date + code) % 899)}`;
    const departMin = 480 + (hash(q.date) % 720); // 08:00–20:00 ish
    const arriveMin = (departMin + durationMinutes) % 1440;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

    return {
      price,
      currency: opts.currency || 'USD',
      airline: name,
      airlineCode: code,
      flightNumber,
      stops,
      durationMinutes,
      durationLabel: minutesToLabel(durationMinutes),
      departTime: hhmm(departMin),
      arriveTime: hhmm(arriveMin),
      seatsLeft: 9,
      bookingLabel: `${q.origin}->${q.destination} ${q.date}`,
      bookingUrl: googleFlightsUrl(q.origin, q.destination, q.date),
    };
  }
}

// --- static (precomputed) provider -------------------------------------------

export class StaticFlightProvider implements FlightProvider {
  constructor(private readonly quotes: Map<string, FlightQuote | null>) {}

  static fromEntries(
    entries: Array<[LegQuery, FlightQuote | null]>,
  ): StaticFlightProvider {
    const map = new Map<string, FlightQuote | null>();
    for (const [q, quote] of entries) map.set(legKey(q), quote);
    return new StaticFlightProvider(map);
  }

  async searchCheapest(q: LegQuery, opts?: SearchOpts): Promise<FlightQuote | null> {
    const quote = this.quotes.get(legKey(q)) ?? null;
    if (!quote) return null;
    const exclude = opts?.excludeAirlines;
    if (exclude?.length) {
      const codes = airlineCodesFromLabel(quote.airline);
      if (codes.some((c) => exclude.includes(c))) return null;
    }
    return quote;
  }
}

// --- real keyed-API template -------------------------------------------------

/**
 * Template for a real flight API you call from your own backend. Fill in the
 * endpoint, auth, and response mapping for your chosen provider. (The Expedia
 * MCP tool used in the live demo is agent-only and cannot be called from user
 * code — use StaticFlightProvider for that path.)
 */
export class HttpFlightProvider implements FlightProvider {
  constructor(
    private readonly opts: {
      endpoint: string;
      apiKey: string;
      mapResponse: (json: unknown) => FlightQuote | null;
    },
  ) {}

  async searchCheapest(
    q: LegQuery,
    opts: { adults: number; cabin: string; currency?: string },
  ): Promise<FlightQuote | null> {
    const url = new URL(this.opts.endpoint);
    url.searchParams.set('origin', q.origin);
    url.searchParams.set('destination', q.destination);
    url.searchParams.set('date', q.date);
    url.searchParams.set('adults', String(opts.adults));
    url.searchParams.set('cabin', opts.cabin);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
    });
    if (!res.ok) return null;
    return this.opts.mapResponse(await res.json());
  }
}
