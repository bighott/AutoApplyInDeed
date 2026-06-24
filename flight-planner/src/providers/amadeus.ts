/**
 * Amadeus Self-Service "Flight Offers Search" provider.
 *
 * Real, bookable itineraries with a generous free quota. Auth is OAuth2
 * client-credentials: we fetch a bearer token and cache it until it expires.
 * Defaults to the test host (test.api.amadeus.com); set AMADEUS_HOSTNAME to
 * 'https://api.amadeus.com' for production.
 */

import type { FlightProvider } from '../planner';
import type { FlightQuote, LegQuery } from '../types';
import { googleFlightsUrl, minutesToLabel } from '../util';

const CABIN: Record<string, string> = {
  ECONOMY: 'ECONOMY',
  PREMIUMECONOMY: 'PREMIUM_ECONOMY',
  BUSINESS: 'BUSINESS',
  FIRST: 'FIRST',
};

/** "PT7H52M" / "P1DT2H" -> minutes. */
function isoDurationToMin(s?: string): number | undefined {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(s ?? '');
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return (m[1] ? +m[1] * 1440 : 0) + (m[2] ? +m[2] * 60 : 0) + (m[3] ? +m[3] : 0);
}

export interface AmadeusOptions {
  host?: string;
  fetchImpl?: typeof fetch;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class AmadeusProvider implements FlightProvider {
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private token = '';
  private tokenExpiresAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    opts: AmadeusOptions = {},
  ) {
    if (!clientId || !clientSecret) {
      throw new Error('AmadeusProvider: clientId and clientSecret are required');
    }
    this.host = opts.host ?? 'https://test.api.amadeus.com';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async authToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 30_000) return this.token;
    const res = await this.fetchImpl(`${this.host}/v1/security/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:
        `grant_type=client_credentials&client_id=${encodeURIComponent(this.clientId)}` +
        `&client_secret=${encodeURIComponent(this.clientSecret)}`,
    });
    if (!res.ok) throw new Error(`Amadeus auth failed (${res.status})`);
    const j = (await res.json()) as any;
    this.token = j.access_token;
    this.tokenExpiresAt = Date.now() + (j.expires_in ? j.expires_in * 1000 : 1_500_000);
    return this.token;
  }

  async searchCheapest(
    q: LegQuery,
    opts: { adults: number; cabin: string; currency?: string },
  ): Promise<FlightQuote | null> {
    const token = await this.authToken();
    const url = new URL(`${this.host}/v2/shopping/flight-offers`);
    url.searchParams.set('originLocationCode', q.origin);
    url.searchParams.set('destinationLocationCode', q.destination);
    url.searchParams.set('departureDate', q.date);
    url.searchParams.set('adults', String(opts.adults));
    url.searchParams.set('travelClass', CABIN[opts.cabin] ?? 'ECONOMY');
    url.searchParams.set('currencyCode', (opts.currency ?? 'USD').toUpperCase());
    url.searchParams.set('max', '1');

    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const offer = data?.data?.[0];
    if (!offer) return null;

    const itin = offer.itineraries?.[0];
    const segs: any[] = itin?.segments ?? [];
    const code = segs[0]?.carrierCode;
    const mins = isoDurationToMin(itin?.duration);
    return {
      price: Number(offer.price?.total),
      currency: offer.price?.currency ?? (opts.currency ?? 'USD').toUpperCase(),
      airline: code,
      airlineCode: code && /^[A-Z0-9]{2}$/.test(code) ? code : undefined,
      stops: Math.max(0, segs.length - 1),
      durationMinutes: mins,
      durationLabel: minutesToLabel(mins),
      departTime: segs[0]?.departure?.at,
      arriveTime: segs[segs.length - 1]?.arrival?.at,
      seatsLeft: typeof offer.numberOfBookableSeats === 'number' ? offer.numberOfBookableSeats : null,
      bookingUrl: googleFlightsUrl(q.origin, q.destination, q.date),
    };
  }
}
