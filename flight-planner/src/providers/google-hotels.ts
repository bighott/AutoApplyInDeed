/**
 * SerpApi Google Hotels provider.
 *
 * SerpApi (https://serpapi.com/google-hotels-api) scrapes Google Hotels and
 * returns structured JSON. This adapter satisfies the AccommodationProvider
 * interface: for one location + date range it returns a normalized list of
 * hotels (and, when requested, vacation rentals) with price, rating, GPS, and a
 * booking link.
 *
 * Notes / gotchas:
 *  - Uses the SAME SerpApi key as Google Flights, just `engine=google_hotels`.
 *  - Billed per search. Hotels and vacation rentals are two DIFFERENT searches
 *    on SerpApi (`vacation_rentals=true`), so including rentals costs one extra.
 *  - `q` is free text ("Paris", "Rome Italy"). Prefer a city name over an IATA
 *    code — Google Hotels searches poorly on bare airport codes.
 *  - Prices are per-night lowest; we also read total_rate for the whole stay.
 */

import type { AccommodationProvider, Stay, StayQuery, StaySearchOpts, StayType } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SerpHotelProperty {
  type?: string; // "hotel" | "vacation rental"
  name?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rate_per_night?: { lowest?: string; extracted_lowest?: number };
  total_rate?: { lowest?: string; extracted_lowest?: number };
  overall_rating?: number;
  reviews?: number;
  amenities?: string[];
  link?: string;
  serpapi_property_details_link?: string;
  images?: Array<{ thumbnail?: string; original_image?: string }>;
  hotel_class?: string;
}

export interface GoogleHotelsOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/** Normalize SerpApi's "vacation rental" / "hotel" strings to our StayType. */
function toStayType(raw: string | undefined): StayType {
  const s = (raw || '').toLowerCase();
  if (s.includes('vacation') || s.includes('rental')) return 'vacation_rental';
  if (s.includes('hotel')) return 'hotel';
  return 'other';
}

export class GoogleHotelsProvider implements AccommodationProvider {
  readonly name = 'Google Hotels';
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    opts: GoogleHotelsOptions = {},
  ) {
    if (!apiKey) throw new Error('GoogleHotelsProvider: apiKey is required');
    this.endpoint = opts.endpoint ?? 'https://serpapi.com/search.json';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async query(q: StayQuery, opts: StaySearchOpts, vacationRentals: boolean): Promise<Stay[]> {
    const currency = opts.currency ?? q.currency ?? 'USD';
    const url = new URL(this.endpoint);
    url.searchParams.set('engine', 'google_hotels');
    url.searchParams.set('q', q.location);
    url.searchParams.set('check_in_date', q.checkIn);
    url.searchParams.set('check_out_date', q.checkOut);
    url.searchParams.set('adults', String(opts.adults));
    url.searchParams.set('currency', currency);
    if (vacationRentals) url.searchParams.set('vacation_rentals', 'true');
    url.searchParams.set('api_key', this.apiKey);

    const res = await this.fetchImpl(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { properties?: SerpHotelProperty[]; error?: string };
    if (data.error || !Array.isArray(data.properties)) return [];

    const cap = opts.maxResults ?? 40;
    return data.properties.slice(0, cap).map((p) => this.toStay(p, currency, vacationRentals));
  }

  private toStay(p: SerpHotelProperty, currency: string, vacationRentals: boolean): Stay {
    const type = vacationRentals ? 'vacation_rental' : toStayType(p.type);
    const per = p.rate_per_night?.extracted_lowest ?? null;
    const total = p.total_rate?.extracted_lowest ?? null;
    return {
      name: p.name || 'Unnamed property',
      type,
      pricePerNight: typeof per === 'number' ? per : null,
      totalPrice: typeof total === 'number' ? total : null,
      currency,
      rating: typeof p.overall_rating === 'number' ? p.overall_rating : null,
      reviews: typeof p.reviews === 'number' ? p.reviews : null,
      lat: p.gps_coordinates?.latitude,
      lon: p.gps_coordinates?.longitude,
      amenities: Array.isArray(p.amenities) ? p.amenities.slice(0, 8) : undefined,
      thumbnail: p.images?.[0]?.thumbnail || undefined,
      bookingUrl: p.link || p.serpapi_property_details_link || undefined,
      source: this.name,
    };
  }

  async searchStays(q: StayQuery, opts: StaySearchOpts): Promise<Stay[]> {
    const wantRentals = opts.includeVacationRentals ?? q.includeVacationRentals ?? false;
    const hotels = await this.query(q, opts, false);
    if (!wantRentals) return hotels;
    // Vacation rentals are a separate SerpApi search (extra billed request).
    const rentals = await this.query(q, opts, true);
    return [...hotels, ...rentals];
  }
}
