/**
 * Airbnb / VRBO provider — SCAFFOLD (not active until you supply a key).
 *
 * Airbnb has no official public API (it was closed to new developers ~2020), and
 * VRBO's real inventory is only reachable through an Expedia Partner Solutions
 * agreement. The pragmatic route for individual builders is an unofficial
 * scraper on RapidAPI (e.g. "Airbnb Scraper", "Airbnb13") or an Apify actor.
 *
 * This adapter targets a RapidAPI-style JSON endpoint. Because each RapidAPI
 * "Airbnb" listing exposes a slightly different response shape, the mapping here
 * is intentionally defensive and easy to adjust once you pick a specific actor.
 *
 * To activate, add to flight-planner/.env:
 *   AIRBNB_RAPIDAPI_KEY=<your RapidAPI key>
 *   AIRBNB_RAPIDAPI_HOST=<the actor host, e.g. airbnb13.p.rapidapi.com>
 *   AIRBNB_RAPIDAPI_URL=<full search URL for that actor>   (optional override)
 *
 * ⚠️ Unofficial scrapers can break, rate-limit, or violate a site's ToS. Use a
 *    reputable actor, respect its limits, and prefer official sources when you
 *    can obtain them (Expedia EPS for VRBO).
 */

import type { AccommodationProvider, Stay, StayQuery, StaySearchOpts, StayType } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AirbnbRapidOptions {
  host: string;
  /** Full search URL template; `{q}` `{in}` `{out}` `{adults}` are substituted. */
  urlTemplate?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_URL =
  'https://{host}/search-location?location={q}&checkin={in}&checkout={out}&adults={adults}&currency={cur}';

/** Pull the first numeric value found under any of the given keys. */
function num(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v.replace(/[^0-9.]/g, '')))) {
      return Number(v.replace(/[^0-9.]/g, ''));
    }
  }
  return null;
}

export class AirbnbRapidApiProvider implements AccommodationProvider {
  readonly name = 'Airbnb/VRBO';
  private readonly host: string;
  private readonly urlTemplate: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    opts: AirbnbRapidOptions,
  ) {
    if (!apiKey) throw new Error('AirbnbRapidApiProvider: apiKey is required (AIRBNB_RAPIDAPI_KEY)');
    if (!opts.host) throw new Error('AirbnbRapidApiProvider: host is required (AIRBNB_RAPIDAPI_HOST)');
    this.host = opts.host;
    this.urlTemplate = opts.urlTemplate ?? DEFAULT_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async searchStays(q: StayQuery, opts: StaySearchOpts): Promise<Stay[]> {
    const currency = opts.currency ?? q.currency ?? 'USD';
    const url = this.urlTemplate
      .replace('{host}', this.host)
      .replace('{q}', encodeURIComponent(q.location))
      .replace('{in}', q.checkIn)
      .replace('{out}', q.checkOut)
      .replace('{adults}', String(opts.adults))
      .replace('{cur}', currency);

    const res = await this.fetchImpl(url, {
      headers: { 'X-RapidAPI-Key': this.apiKey, 'X-RapidAPI-Host': this.host },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;

    // Actors vary: results live under `results`, `data`, or the root array.
    const rows: any[] = Array.isArray(data)
      ? data
      : data.results ?? data.data ?? data.listings ?? [];
    const cap = opts.maxResults ?? 40;

    return rows.slice(0, cap).map((row): Stay => {
      const per = num(row, ['price', 'rate', 'pricePerNight', 'nightlyPrice']);
      const total = num(row, ['total', 'totalPrice', 'priceTotal']);
      const rating = num(row, ['rating', 'stars', 'avgRating']);
      const type: StayType = /vrbo|home|villa|apartment|rental/i.test(String(row.type || row.roomType || ''))
        ? 'vacation_rental'
        : 'vacation_rental'; // Airbnb/VRBO are all short-term rentals
      return {
        name: row.name || row.title || 'Airbnb/VRBO listing',
        type,
        pricePerNight: per,
        totalPrice: total,
        currency,
        rating: rating != null ? Math.min(5, rating) : null,
        reviews: num(row, ['reviews', 'reviewsCount', 'numberOfReviews']),
        lat: num(row, ['lat', 'latitude']) ?? undefined,
        lon: num(row, ['lng', 'lon', 'longitude']) ?? undefined,
        address: row.address || row.city || undefined,
        thumbnail: row.image || row.thumbnail || (Array.isArray(row.images) ? row.images[0] : undefined),
        bookingUrl: row.url || row.deeplink || row.link || undefined,
        source: this.name,
      };
    });
  }
}
