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
import type { FlightQuote, LegQuery } from '../types';
import { googleFlightsUrl, minutesToLabel } from '../util';

export interface TravelpayoutsOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
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

  async searchCheapest(
    q: LegQuery,
    opts: { adults: number; cabin: string; currency?: string },
  ): Promise<FlightQuote | null> {
    const currency = (opts.currency ?? 'USD').toUpperCase();
    const url = new URL(this.endpoint);
    url.searchParams.set('origin', q.origin);
    url.searchParams.set('destination', q.destination);
    url.searchParams.set('departure_at', q.date);
    url.searchParams.set('one_way', 'true');
    url.searchParams.set('currency', currency.toLowerCase());
    url.searchParams.set('sorting', 'price');
    url.searchParams.set('limit', '1');
    url.searchParams.set('token', this.token);

    const res = await this.fetchImpl(url, { headers: { 'x-access-token': this.token } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const f = data?.data?.[0];
    if (!f || typeof f.price !== 'number') return null;

    const code = typeof f.airline === 'string' ? f.airline.toUpperCase() : undefined;
    const dur = typeof f.duration === 'number' && f.duration > 0 ? f.duration : undefined;
    return {
      price: Number(f.price),
      currency,
      airline: code,
      airlineCode: code && /^[A-Z0-9]{2}$/.test(code) ? code : undefined,
      stops: typeof f.transfers === 'number' ? f.transfers : undefined,
      durationMinutes: dur,
      durationLabel: minutesToLabel(dur),
      departTime: typeof f.departure_at === 'string' ? f.departure_at : undefined,
      seatsLeft: null,
      bookingUrl: f.link
        ? `https://www.aviasales.com${f.link}`
        : googleFlightsUrl(q.origin, q.destination, q.date),
    };
  }
}
