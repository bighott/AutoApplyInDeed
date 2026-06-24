/**
 * SerpApi Google Flights provider.
 *
 * SerpApi (https://serpapi.com/google-flights-api) scrapes Google Flights and
 * returns structured JSON. This adapter satisfies the planner's FlightProvider
 * interface: for one (origin, destination, date) leg it queries SerpApi for
 * one-way fares and maps the cheapest result into a FlightQuote.
 *
 * Notes / gotchas:
 *  - `departure_id` / `arrival_id` want IATA codes (SFO, JFK, LHR). City names
 *    can fail — pass airport/metro codes from your TripSpec.
 *  - One leg/date = one SerpApi search (billed per search). The planner runs one
 *    search per *unique* leg, so wide night ranges × startFlexDays multiply cost.
 *  - Scraped results don't expose seat counts, so `seatsLeft` is null.
 */

import type { FlightProvider } from '../planner';
import { codeForAirlineName } from '../airlines';
import type { FlightQuote, LegQuery, SearchOpts } from '../types';
import { googleFlightsUrl, minutesToLabel } from '../util';

/** Map our CabinClass to SerpApi `travel_class` (1=econ,2=prem,3=biz,4=first). */
const TRAVEL_CLASS: Record<string, string> = {
  ECONOMY: '1',
  PREMIUMECONOMY: '2',
  BUSINESS: '3',
  FIRST: '4',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SerpFlightOption {
  price?: number;
  total_duration?: number;
  airline_logo?: string;
  flights?: Array<{
    airline?: string;
    airline_logo?: string;
    flight_number?: string;
    departure_airport?: { id?: string; time?: string };
    arrival_airport?: { id?: string; time?: string };
  }>;
}

export interface SerpApiOptions {
  /** Override the endpoint (e.g. for a self-hosted proxy). */
  endpoint?: string;
  /** Injected fetch for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class SerpApiGoogleFlightsProvider implements FlightProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    opts: SerpApiOptions = {},
  ) {
    if (!apiKey) throw new Error('SerpApiGoogleFlightsProvider: apiKey is required');
    this.endpoint = opts.endpoint ?? 'https://serpapi.com/search.json';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async searchCheapest(q: LegQuery, opts: SearchOpts): Promise<FlightQuote | null> {
    const currency = opts.currency ?? 'USD';
    const url = new URL(this.endpoint);
    url.searchParams.set('engine', 'google_flights');
    url.searchParams.set('departure_id', q.origin);
    url.searchParams.set('arrival_id', q.destination);
    url.searchParams.set('outbound_date', q.date);
    url.searchParams.set('type', '2'); // 2 = one-way (planner prices legs individually)
    url.searchParams.set('adults', String(opts.adults));
    url.searchParams.set('travel_class', TRAVEL_CLASS[opts.cabin] ?? '1');
    url.searchParams.set('currency', currency);
    url.searchParams.set('api_key', this.apiKey);

    const res = await this.fetchImpl(url);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      best_flights?: SerpFlightOption[];
      other_flights?: SerpFlightOption[];
      error?: string;
    };
    if (data.error) return null;

    const exclude = new Set((opts.excludeAirlines ?? []).map((c) => c.toUpperCase()));
    const optionExcluded = (o: SerpFlightOption): boolean =>
      (o.flights ?? []).some((s) => {
        const code = (s.flight_number?.trim().slice(0, 2) || codeForAirlineName(s.airline) || '').toUpperCase();
        return code && exclude.has(code);
      });

    const all = [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
      .filter((o) => typeof o.price === 'number')
      .filter((o) => !exclude.size || !optionExcluded(o));
    if (all.length === 0) return null;
    all.sort((a, b) => (a.price as number) - (b.price as number));

    const best = all[0];
    const segs = best.flights ?? [];
    const airlines = [...new Set(segs.map((s) => s.airline).filter(Boolean))];
    // First segment's flight number prefix is the operating airline's IATA code.
    const code = segs[0]?.flight_number?.trim().slice(0, 2).toUpperCase();

    return {
      price: best.price as number,
      currency,
      airline: airlines.join(', ') || undefined,
      airlineCode: code && /^[A-Z0-9]{2}$/.test(code) ? code : undefined,
      flightNumber: segs[0]?.flight_number?.replace(/\s+/g, '') || undefined,
      airlineLogo: best.airline_logo || segs[0]?.airline_logo || undefined,
      stops: Math.max(0, segs.length - 1),
      durationMinutes: best.total_duration,
      durationLabel: minutesToLabel(best.total_duration),
      departTime: segs[0]?.departure_airport?.time,
      arriveTime: segs[segs.length - 1]?.arrival_airport?.time,
      seatsLeft: null,
      bookingUrl: googleFlightsUrl(q.origin, q.destination, q.date),
      segments: segs.map((s) => ({
        from: s.departure_airport?.id,
        to: s.arrival_airport?.id,
        airline: s.airline,
        flightNumber: s.flight_number,
        departTime: s.departure_airport?.time,
        arriveTime: s.arrival_airport?.time,
      })),
    };
  }
}
