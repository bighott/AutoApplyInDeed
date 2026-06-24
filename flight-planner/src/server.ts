/**
 * Local web UI for the flight planner.
 *
 * Zero-dependency HTTP server (Node's built-in `http`): serves the single-page
 * UI from ./public and exposes POST /api/plan. The SerpApi key stays server-side
 * (loaded from .env) — the browser never sees it.
 *
 *   npm run ui        then open the printed URL
 *
 * Providers selectable from the UI:
 *   - mock       deterministic offline pricing (works for any input, no key)
 *   - serpapi    live Google Flights via your SERPAPI_KEY
 *   - crosscheck SerpApi vs Expedia snapshot; plans on the cheaper per leg
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { cityOf, searchAirports } from './airports';
import { planAdvisor, type AdvisorSpec } from './advisor';
import { CachingProvider } from './cache';
import { CheapestOfProvider, compareLegPrices, type NamedProvider } from './crosscheck';
import { loadEnv, requireEnv } from './env';
import { formatPlan } from './format';
import { expediaStaticProvider } from './expedia-fares';
import {
  budgetError,
  enumerateItineraries,
  planTrip,
  uniqueLegQueries,
  type FlightProvider,
} from './planner';
import {
  MockFlightProvider,
  StaticFlightProvider,
} from './provider';
import { SerpApiGoogleFlightsProvider } from './providers/serpapi-google-flights';
import { TravelpayoutsProvider } from './providers/travelpayouts';
import { AmadeusProvider } from './providers/amadeus';
import type { FlightQuote, TripSpec } from './types';

loadEnv();

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC = resolve(process.cwd(), 'public');
const INDEX = resolve(PUBLIC, 'index.html');

// --- fare cache + budget cap (token-saving) ----------------------------------
const FARE_TTL_MS = (Number(process.env.FARE_TTL_MIN) || 30) * 60_000;
const MAX_SEARCHES = Number(process.env.MAX_SEARCHES) || 250;
// Shared across requests and both tabs, so overlapping/repeated legs are free.
const fareCache = new Map<string, { quote: import('./types').FlightQuote | null; expires: number }>();

// Underlying providers are singletons so stateful auth (Amadeus OAuth token) persists.
const singletons: Record<string, FlightProvider> = {};
function singleton(kind: string, make: () => FlightProvider): FlightProvider {
  if (!singletons[kind]) singletons[kind] = make();
  return singletons[kind];
}
function cached(namespace: string, inner: FlightProvider): FlightProvider {
  return new CachingProvider(inner, fareCache, { ttlMs: FARE_TTL_MS, namespace });
}

/** A SerpApi provider wrapped in the shared TTL cache. */
function cachedSerp(key: string): FlightProvider {
  return cached('serpapi', singleton('serpapi', () => new SerpApiGoogleFlightsProvider(key)));
}
function cachedTravelpayouts(): FlightProvider {
  return cached('travelpayouts', singleton('travelpayouts',
    () => new TravelpayoutsProvider(requireEnv('TRAVELPAYOUTS_TOKEN'))));
}
function cachedAmadeus(): FlightProvider {
  return cached('amadeus', singleton('amadeus',
    () => new AmadeusProvider(requireEnv('AMADEUS_CLIENT_ID'), requireEnv('AMADEUS_CLIENT_SECRET'),
      { host: process.env.AMADEUS_HOSTNAME })));
}

/** Live, quota-billed sources (the budget cap applies to these). */
const BILLED = new Set(['serpapi', 'amadeus', 'crosscheck']);

/** Every source the user has configured — used by cross-check to fill gaps. */
function configuredSources(): NamedProvider[] {
  const out: NamedProvider[] = [];
  if (process.env.SERPAPI_KEY) out.push({ name: 'Google Flights', provider: cachedSerp(requireEnv('SERPAPI_KEY')) });
  if (process.env.TRAVELPAYOUTS_TOKEN) out.push({ name: 'Travelpayouts', provider: cachedTravelpayouts() });
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    out.push({ name: 'Amadeus', provider: cachedAmadeus() });
  }
  out.push({ name: 'Expedia', provider: expediaStaticProvider }); // always available, free
  return out;
}

// Strict policy: same-origin scripts only, NO eval / inline script. Inline
// styles are allowed ('unsafe-inline' in style-src) — that's a style concern,
// not a script-injection vector.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https://pics.avs.io https://www.gstatic.com https://*.gstatic.com https://lh3.googleusercontent.com; " +
  "connect-src 'self'; base-uri 'self'; frame-ancestors 'none'";

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) rej(new Error('payload too large'));
    });
    req.on('end', () => res(data));
    req.on('error', rej);
  });
}

/** Parse an optional list of 2-char IATA airline codes to exclude. */
function parseExclude(raw: any): string[] | undefined {
  const a: any[] = Array.isArray(raw.excludeAirlines) ? raw.excludeAirlines : [];
  const codes = [
    ...new Set(
      a.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z0-9]{2}$/.test(c)),
    ),
  ];
  return codes.length ? codes : undefined;
}

/** Validate + coerce the posted spec into a TripSpec, throwing on bad input. */
function toSpec(raw: any): TripSpec {
  if (!raw || typeof raw !== 'object') throw new Error('Missing trip spec');
  const originList: string[] = Array.isArray(raw.origins) && raw.origins.length
    ? raw.origins
    : raw.origin
      ? [raw.origin]
      : [];
  const origins = [
    ...new Set(originList.map((o: any) => String(o).trim().toUpperCase()).filter(Boolean)),
  ];
  if (origins.length === 0) throw new Error('At least one origin airport is required');
  if (!Array.isArray(raw.stops) || raw.stops.length === 0) {
    throw new Error('Add at least one stop');
  }
  const stops = raw.stops.map((s: any, i: number) => {
    const code = String(s.code || '').trim().toUpperCase();
    if (!code) throw new Error(`Stop ${i + 1}: code is required`);
    const minNights = Number(s.minNights);
    if (!Number.isFinite(minNights) || minNights < 0) {
      throw new Error(`Stop ${code}: min nights must be a number ≥ 0`);
    }
    // maxNights is optional now — left undefined unless a valid number is given.
    let maxNights: number | undefined;
    if (s.maxNights != null && String(s.maxNights).trim() !== '') {
      maxNights = Number(s.maxNights);
      if (!Number.isFinite(maxNights) || maxNights < minNights) {
        throw new Error(`Stop ${code}: max nights must be ≥ min nights`);
      }
    }
    return { code, label: s.label ? String(s.label) : undefined, minNights, maxNights };
  });
  const startDate = String(raw.startDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Start date must be yyyy-mm-dd');
  }
  let endDate: string | undefined;
  if (raw.endDate && String(raw.endDate).trim()) {
    endDate = String(raw.endDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('End date must be yyyy-mm-dd');
    if (endDate < startDate) throw new Error('End date must be on or after the start date');
    const windowDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
    const minTotal = stops.reduce((sum: number, s: any) => sum + s.minNights, 0);
    if (minTotal > windowDays) {
      throw new Error(`The minimum stay (${minTotal} nights) is longer than the date window (${windowDays} days). Extend the end date or lower minimum nights.`);
    }
  } else if (stops.some((s: any) => s.maxNights == null)) {
    throw new Error('Set a max nights for each stop, or add an end date so we can bound the trip.');
  }
  const cabin = String(raw.cabin || 'ECONOMY').toUpperCase();
  const allowed = ['ECONOMY', 'PREMIUMECONOMY', 'BUSINESS', 'FIRST'];
  if (!allowed.includes(cabin)) throw new Error(`Cabin must be one of ${allowed.join(', ')}`);

  return {
    origin: origins[0],
    origins,
    stops,
    returnToOrigin: raw.returnToOrigin !== false,
    startDate,
    endDate,
    startFlexDays: Math.max(1, Number(raw.startFlexDays) || 1),
    adults: Math.max(1, Number(raw.adults) || 1),
    cabin: cabin as TripSpec['cabin'],
    currency: raw.currency ? String(raw.currency).toUpperCase() : 'USD',
    excludeAirlines: parseExclude(raw),
  };
}

async function runPlan(spec: TripSpec, providerKind: string) {
  if (providerKind === 'mock') {
    const plan = await planTrip(new MockFlightProvider(), spec);
    return { plan, comparison: null };
  }

  if (providerKind === 'expedia') {
    const plan = await planTrip(expediaStaticProvider, spec);
    return { plan, comparison: null };
  }

  if (providerKind === 'travelpayouts') {
    const plan = await planTrip(cachedTravelpayouts(), spec); // free tier — no budget cap
    return { plan, comparison: null };
  }

  if (providerKind === 'amadeus') {
    const plan = await planTrip(cachedAmadeus(), spec, { maxSearches: MAX_SEARCHES });
    return { plan, comparison: null };
  }

  if (providerKind === 'serpapi') {
    const plan = await planTrip(cachedSerp(requireEnv('SERPAPI_KEY')), spec, {
      maxSearches: MAX_SEARCHES,
    });
    return { plan, comparison: null };
  }

  if (providerKind === 'crosscheck') {
    // Combine every configured source and take the cheapest per leg, so a gap in
    // one (e.g. Travelpayouts) is filled by another (Amadeus / Google / Expedia).
    const named = configuredSources();
    const legs = uniqueLegQueries(enumerateItineraries(spec).skeletons);
    const opts = { adults: spec.adults, cabin: spec.cabin, currency: spec.currency || 'USD', excludeAirlines: spec.excludeAirlines };
    const billable = named.reduce((sum, { provider }) => sum + (provider.countBillable?.(legs, opts) ?? 0), 0);
    if (billable > MAX_SEARCHES) throw budgetError(billable, MAX_SEARCHES);

    // Price once via the comparison, then plan on the cheapest-per-leg result
    // (a StaticFlightProvider) so we don't bill the live sources a second time.
    const comparison = await compareLegPrices(spec, named);
    const entries = comparison.rows.map((r) => {
      const src = r.cheapestProvider;
      const quote: FlightQuote | null = src ? r.quotes[src] : null;
      return [
        r.leg,
        quote ? { ...quote, bookingLabel: `cheapest: ${src}` } : null,
      ] as [typeof r.leg, FlightQuote | null];
    });
    const cheapestProvider: FlightProvider = StaticFlightProvider.fromEntries(entries);
    const plan = await planTrip(cheapestProvider, spec);
    return { plan, comparison };
  }

  throw new Error(`Unknown provider "${providerKind}"`);
}

/** A single (cached) FlightProvider for the advisor; cheapest-of for cross-check. */
function makeProvider(kind: string): FlightProvider {
  if (kind === 'mock') return new MockFlightProvider();
  if (kind === 'expedia') return expediaStaticProvider;
  if (kind === 'travelpayouts') return cachedTravelpayouts();
  if (kind === 'amadeus') return cachedAmadeus();
  if (kind === 'serpapi') return cachedSerp(requireEnv('SERPAPI_KEY'));
  if (kind === 'crosscheck') return new CheapestOfProvider(configuredSources());
  throw new Error(`Unknown provider "${kind}"`);
}

/** Validate + coerce the posted advisor request into an AdvisorSpec. */
function toAdvisorSpec(raw: any): AdvisorSpec {
  if (!raw || typeof raw !== 'object') throw new Error('Missing trip request');
  const rawOrigins: any[] = Array.isArray(raw.origins) ? raw.origins : [];
  const origins = [
    ...new Set(rawOrigins.map((o) => String(o).trim().toUpperCase()).filter(Boolean)),
  ];
  if (origins.length === 0) throw new Error('Add at least one origin airport.');
  if (!Array.isArray(raw.destinations) || raw.destinations.length === 0) {
    throw new Error('Add at least one place to visit.');
  }
  // Optional in MONTH/window mode — validated in planAdvisor.
  let totalNights: number | undefined;
  if (raw.totalNights != null && String(raw.totalNights).trim() !== '') {
    totalNights = Number(raw.totalNights);
    if (!Number.isFinite(totalNights) || totalNights < 1) {
      throw new Error('Total nights must be a positive number.');
    }
  }
  const destinations = raw.destinations.map((d: any, i: number) => {
    const code = String(d.code || '').trim().toUpperCase();
    if (!code) throw new Error(`Destination ${i + 1}: code is required.`);
    const minNights = d.minNights != null ? Number(d.minNights) : undefined;
    const maxNights = d.maxNights != null ? Number(d.maxNights) : undefined;
    if (minNights != null && maxNights != null && maxNights < minNights) {
      throw new Error(`Destination ${code}: max nights < min nights.`);
    }
    return { code, label: d.label ? String(d.label) : undefined, minNights, maxNights };
  });
  const startDate = String(raw.startDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Earliest departure must be yyyy-mm-dd.');
  // Accept endDate (new) or latestReturn (legacy) as the latest return.
  const endRaw = raw.endDate ?? raw.latestReturn;
  const endDate = endRaw ? String(endRaw).trim() : undefined;
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Latest return / end date must be yyyy-mm-dd.');
  }
  if (endDate && endDate < startDate) throw new Error('End date must be on or after the start date.');
  const cabin = String(raw.cabin || 'ECONOMY').toUpperCase();

  return {
    origins,
    destinations,
    startDate,
    endDate,
    totalNights,
    returnToOrigin: raw.returnToOrigin !== false,
    optimizeGeography: raw.optimizeGeography !== false,
    excludeAirlines: parseExclude(raw),
    adults: Math.max(1, Number(raw.adults) || 1),
    cabin,
    currency: raw.currency ? String(raw.currency).toUpperCase() : 'USD',
  };
}

const server = createServer(async (req, res) => {
  try {
    // Route by pathname so query strings (e.g. cache-busting /?v=2) still match.
    const u = new URL(req.url || '/', 'http://localhost');
    const path = u.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      const html = await readFile(INDEX);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP,
        // Never cache the UI shell — avoids stale JS after an update.
        'cache-control': 'no-store, must-revalidate',
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && path === '/app.js') {
      const js = await readFile(resolve(PUBLIC, 'app.js'));
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-security-policy': CSP,
        'cache-control': 'no-store, must-revalidate',
      });
      res.end(js);
      return;
    }

    if (req.method === 'GET' && path === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    // Whether a SerpApi key is configured — lets the UI warn before a failed run.
    if (req.method === 'GET' && path === '/api/config') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        hasSerpApiKey: Boolean(process.env.SERPAPI_KEY),
        providers: {
          serpapi: Boolean(process.env.SERPAPI_KEY),
          travelpayouts: Boolean(process.env.TRAVELPAYOUTS_TOKEN),
          amadeus: Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET),
        },
      }));
      return;
    }

    // Airport type-ahead for the UI's location fields.
    if (req.method === 'GET' && path === '/api/airports') {
      const matches = searchAirports(
        u.searchParams.get('q') || '',
        Number(u.searchParams.get('limit')) || 8,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(matches));
      return;
    }

    // Diagnostic: show the raw upstream response for one leg, plus what we mapped.
    if (req.method === 'GET' && path === '/api/debug-leg') {
      const origin = (u.searchParams.get('origin') || '').toUpperCase();
      const destination = (u.searchParams.get('destination') || '').toUpperCase();
      const date = u.searchParams.get('date') || '';
      const currency = (u.searchParams.get('currency') || 'USD').toUpperCase();
      const prov = u.searchParams.get('provider') || 'travelpayouts';
      const out: any = { provider: prov, leg: { origin, destination, date } };
      try {
        if (prov === 'travelpayouts') {
          const token = requireEnv('TRAVELPAYOUTS_TOKEN');
          const tu = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
          tu.searchParams.set('origin', origin);
          tu.searchParams.set('destination', destination);
          tu.searchParams.set('departure_at', date);
          tu.searchParams.set('one_way', 'true');
          tu.searchParams.set('currency', currency.toLowerCase());
          tu.searchParams.set('sorting', 'price');
          tu.searchParams.set('limit', '3');
          tu.searchParams.set('token', token);
          const r = await fetch(tu, { headers: { 'x-access-token': token } });
          out.status = r.status;
          out.rawBody = (await r.text()).slice(0, 1500);
          out.requestUrl = tu.toString().replace(token, '***');
        } else {
          out.error = `debug not implemented for "${prov}" (use travelpayouts)`;
        }
        out.mapped = await makeProvider(prov).searchCheapest(
          { origin, destination, date },
          { adults: 1, cabin: 'ECONOMY', currency },
        );
      } catch (e) {
        out.error = e instanceof Error ? e.message : String(e);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out, null, 2));
      return;
    }

    if (req.method === 'POST' && path === '/api/plan') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const spec = toSpec(body.spec);
      const provider = String(body.provider || 'mock');
      const { plan, comparison } = await runPlan(spec, provider);
      // City names for every code in the trip, so the UI can write plain-English
      // explanations and auto-fill labels.
      const cityByCode: Record<string, string> = {};
      for (const code of [...(spec.origins ?? [spec.origin]), ...spec.stops.map((s) => s.code)]) {
        const city = cityOf(code);
        if (city) cityByCode[code] = city;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          provider,
          spec,
          plan,
          comparison,
          cityByCode,
          textPlan: formatPlan(spec, plan),
        }),
      );
      return;
    }

    // "Plan my trip" — route-optimizing advisor.
    if (req.method === 'POST' && path === '/api/plan-trip') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const spec = toAdvisorSpec(body.spec);
      const provider = String(body.provider || 'mock');
      const result = await planAdvisor(makeProvider(provider), spec, {
        maxSearches: BILLED.has(provider) ? MAX_SEARCHES : undefined,
      });
      const cityByCode: Record<string, string> = {};
      for (const code of [...spec.origins, ...spec.destinations.map((d) => d.code)]) {
        const city = cityOf(code);
        if (city) cityByCode[code] = city;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, provider, spec, result, cityByCode }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Flight planner UI running:  http://localhost:${PORT}\n`);
  console.log('  Stop with Ctrl+C.\n');
});
