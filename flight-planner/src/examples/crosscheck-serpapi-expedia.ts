/**
 * Cross-check SerpApi (Google Flights, LIVE) against Expedia fares, then plan on
 * the cheapest source per leg.
 *
 *   npm run example:crosscheck     (needs SERPAPI_KEY in .env)
 *
 * About the two sources:
 *   - SerpApi runs live from your key (user-callable HTTP API).
 *   - Expedia's flight search is an agent-only MCP tool that user code cannot
 *     call directly, so its side is served from a StaticFlightProvider seeded
 *     with fares the agent pulled via Expedia on 2026-06-24. To refresh them,
 *     ask the agent to re-pull the same legs through the Expedia tool and
 *     replace the entries below. (This is the documented Expedia path — see
 *     provider.ts.)
 *
 * Both providers are also combined via CheapestOfProvider and handed to
 * planTrip(), so the final itinerary is priced on the best of the two per leg.
 */

import { CheapestOfProvider, compareLegPrices, formatComparison } from '../crosscheck';
import { loadEnv, requireEnv } from '../env';
import { formatPlan } from '../format';
import { planTrip } from '../planner';
import { SerpApiGoogleFlightsProvider } from '../providers/serpapi-google-flights';
import { StaticFlightProvider } from '../provider';
import type { FlightQuote, LegQuery, TripSpec } from '../types';

loadEnv();

function q(
  origin: string,
  destination: string,
  date: string,
  price: number,
  airline: string,
  seatsLeft: number,
  stops: number,
  durationLabel: string,
): [LegQuery, FlightQuote] {
  return [
    { origin, destination, date },
    { price, currency: 'USD', airline, seatsLeft, stops, durationLabel },
  ];
}

// Expedia fares (agent-pulled 2026-06-24) — the static cross-check baseline.
const expedia = StaticFlightProvider.fromEntries([
  q('SFO', 'JFK', '2026-07-15', 183.2, 'American', 7, 1, '7h 52m'),
  q('JFK', 'LHR', '2026-07-17', 314.5, 'Delta/Virgin Atlantic', 9, 0, '6h 55m'),
  q('JFK', 'LHR', '2026-07-18', 284.5, 'British Airways', 0, 0, '6h 55m'),
  q('LHR', 'SFO', '2026-07-20', 1289.63, 'TAP Portugal', 0, 1, '29h 15m'),
  q('LHR', 'SFO', '2026-07-21', 909.33, 'TAP Portugal', 0, 1, '26h 45m'),
  q('LHR', 'SFO', '2026-07-22', 909.33, 'TAP Portugal', 0, 1, '26h 40m'),
]);

const serpapi = new SerpApiGoogleFlightsProvider(requireEnv('SERPAPI_KEY'));

const spec: TripSpec = {
  origin: 'SFO',
  stops: [
    { code: 'JFK', label: 'New York', minNights: 2, maxNights: 3 },
    { code: 'LHR', label: 'London', minNights: 3, maxNights: 4 },
  ],
  returnToOrigin: true,
  startDate: '2026-07-15',
  startFlexDays: 1,
  adults: 1,
  cabin: 'ECONOMY',
};

async function main(): Promise<void> {
  const named = [
    { name: 'SerpApi', provider: serpapi },
    { name: 'Expedia', provider: expedia },
  ];

  console.log('=== SerpApi vs Expedia cross-check ===\n');
  const report = await compareLegPrices(spec, named);
  console.log(formatComparison(spec, report));

  console.log('\n=== Plan on cheapest-of-both ===\n');
  const result = await planTrip(new CheapestOfProvider(named), spec);
  console.log(formatPlan(spec, result));
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
