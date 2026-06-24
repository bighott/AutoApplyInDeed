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
import type { FlightQuote, LegQuery } from './types';

// --- deterministic mock (offline) --------------------------------------------

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export class MockFlightProvider implements FlightProvider {
  async searchCheapest(
    q: LegQuery,
    opts: { adults: number; cabin: string; currency?: string },
  ): Promise<FlightQuote | null> {
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
    return {
      price,
      currency: opts.currency || 'USD',
      airline: 'MockAir',
      stops: dateVar > 90 ? 1 : 0,
      durationLabel: '8h 00m',
      departTime: '09:00',
      arriveTime: '17:00',
      seatsLeft: 9,
      bookingLabel: `${q.origin}->${q.destination} ${q.date}`,
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

  async searchCheapest(q: LegQuery): Promise<FlightQuote | null> {
    return this.quotes.get(legKey(q)) ?? null;
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
