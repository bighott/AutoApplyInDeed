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
import { compareLegPrices, type NamedProvider } from './crosscheck';
import { loadEnv, requireEnv } from './env';
import { formatPlan } from './format';
import { expediaStaticProvider } from './expedia-fares';
import { planTrip, type FlightProvider } from './planner';
import {
  MockFlightProvider,
  StaticFlightProvider,
} from './provider';
import { SerpApiGoogleFlightsProvider } from './providers/serpapi-google-flights';
import type { FlightQuote, TripSpec } from './types';

loadEnv();

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC = resolve(process.cwd(), 'public');
const INDEX = resolve(PUBLIC, 'index.html');

// Strict policy: same-origin scripts only, NO eval / inline script. Inline
// styles are allowed ('unsafe-inline' in style-src) — that's a style concern,
// not a script-injection vector.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'";

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
    const maxNights = Number(s.maxNights);
    if (!Number.isFinite(minNights) || !Number.isFinite(maxNights)) {
      throw new Error(`Stop ${code}: nights must be numbers`);
    }
    if (minNights < 0 || maxNights < minNights) {
      throw new Error(`Stop ${code}: need 0 ≤ min ≤ max nights`);
    }
    return {
      code,
      label: s.label ? String(s.label) : undefined,
      minNights,
      maxNights,
    };
  });
  const startDate = String(raw.startDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Start date must be yyyy-mm-dd');
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
    startFlexDays: Math.max(1, Number(raw.startFlexDays) || 1),
    adults: Math.max(1, Number(raw.adults) || 1),
    cabin: cabin as TripSpec['cabin'],
    currency: raw.currency ? String(raw.currency).toUpperCase() : 'USD',
  };
}

async function runPlan(spec: TripSpec, providerKind: string) {
  if (providerKind === 'mock') {
    const plan = await planTrip(new MockFlightProvider(), spec);
    return { plan, comparison: null };
  }

  if (providerKind === 'serpapi') {
    const key = requireEnv('SERPAPI_KEY');
    const plan = await planTrip(new SerpApiGoogleFlightsProvider(key), spec);
    return { plan, comparison: null };
  }

  if (providerKind === 'crosscheck') {
    const key = requireEnv('SERPAPI_KEY');
    const named: NamedProvider[] = [
      { name: 'SerpApi', provider: new SerpApiGoogleFlightsProvider(key) },
      { name: 'Expedia', provider: expediaStaticProvider },
    ];
    // Price once via the comparison, then plan on the cheapest-per-leg result
    // (a StaticFlightProvider) so we don't bill SerpApi a second time.
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
      res.end(JSON.stringify({ hasSerpApiKey: Boolean(process.env.SERPAPI_KEY) }));
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
