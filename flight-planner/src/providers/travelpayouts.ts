/**
 * Travelpayouts (Aviasales) flight-price provider.
 *
 * Uses the free "prices_for_dates" data endpoint — real, cached fares for an
 * (origin, destination, date) leg. Free with a TRAVELPAYOUTS_TOKEN; prices are
 * aggregated/cached rather than live-bookable, so it's ideal for cheap "what's
 * the fare" exploration. The airline field is a 2-letter IATA code, which we
 * also use for the logo.
 */

import type { FlightProvider } from '../planner';
import type { FlightQuote, LegQuery, SearchOpts } from '../types';
import { googleFlightsUrl, minutesToLabel } from '../util';

export interface TravelpayoutsOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/** Best-effort: pull the airport chain (e.g. JFK,KEF,LHR) out of an Aviasales link. */
function airportChain(link?: string): string[] | undefined {
  if (typeof link !== 'string') return undefined;
  const t = /[?&]t=([^&]+)/.exec(link);
  const v = t ? t[1] : link;
  const m = /([A-Z]{6,})_/.exec(v);
  if (!m || m[1].length % 3 !== 0) return undefined;
  const codes: string[] = [];
  for (let i = 0; i < m[1].length; i += 3) codes.push(m[1].slice(i, i + 3));
  return codes.length >= 2 ? codes : undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class TravelpayoutsProvider implements FlightProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly token: string, opts: TravelpayoutsOptions = {}) {
    if (!token) throw new Error('TravelpayoutsProvider: token is required');
    this.endpoint = opts.endpoint ?? 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async searchCheapest(q: LegQuery, opts: SearchOpts): Promise<FlightQuote | null> {
    const currency = (opts.currency ?? 'USD').toUpperCase();
    // Exact-date first; if the cache has nothing, retry at month level and keep
    // only entries that actually depart on the requested date.
    let items = await this.query(q.origin, q.destination, q.date, currency);
    if (!items.length) {
      const month = await this.query(q.origin, q.destination, q.date.slice(0, 7), currency);
      items = month.filter(
        (f) => typeof f.departure_at === 'string' && f.departure_at.slice(0, 10) === q.date,
      );
    }
    const exclude = new Set((opts.excludeAirlines ?? []).map((c) => c.toUpperCase()));
    if (exclude.size) {
      items = items.filter((f) => !(typeof f.airline === 'string' && exclude.has(f.airline.toUpperCase())));
    }
    if (!items.length) return null;
    items.sort((a, b) => (Number(a.price) || 1e9) - (Number(b.price) || 1e9));
    const f = items[0];
    if (typeof f.price !== 'number') return null;

    const code = typeof f.airline === 'string' ? f.airline.toUpperCase() : undefined;
    const dur = typeof f.duration === 'number' && f.duration > 0 ? f.duration : undefined;
    const chain = airportChain(f.link);
    const segments =
      chain && chain.length >= 2
        ? chain.slice(0, -1).map((from, i) => ({ from, to: chain[i + 1], airlineCode: code }))
        : undefined;
    return {
      price: Number(f.price),
      currency,
      airline: code,
      airlineCode: code && /^[A-Z0-9]{2}$/.test(code) ? code : undefined,
      flightNumber: code && f.flight_number ? `${code}${f.flight_number}` : undefined,
      stops: typeof f.transfers === 'number' ? f.transfers : undefined,
      durationMinutes: dur,
      durationLabel: minutesToLabel(dur),
      departTime: typeof f.departure_at === 'string' ? f.departure_at : undefined,
      seatsLeft: null,
      bookingUrl: f.link
        ? `https://www.aviasales.com${f.link}`
        : googleFlightsUrl(q.origin, q.destination, q.date),
      segments,
    };
  }

  /** Raw prices_for_dates query for a date (YYYY-MM-DD) or month (YYYY-MM). */
  private async query(
    origin: string,
    destination: string,
    departureAt: string,
    currency: string,
  ): Promise<any[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('departure_at', departureAt);
    url.searchParams.set('one_way', 'true');
    url.searchParams.set('currency', currency.toLowerCase());
    url.searchParams.set('sorting', 'price');
    url.searchParams.set('limit', '30');
    url.searchParams.set('token', this.token);
    const res = await this.fetchImpl(url, { headers: { 'x-access-token': this.token } });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return Array.isArray(data?.data) ? data.data : [];
  }
}
