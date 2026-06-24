/**
 * LIVE SerpApi (Google Flights) example.
 *
 * Prices a real multi-city, multi-day trip by calling SerpApi for every unique
 * leg/date, then lets the planner pick the cheapest combination of dates.
 *
 * Setup:
 *   1. cp .env.example .env
 *   2. put your key in .env  ->  SERPAPI_KEY=xxxxxxxx
 *   3. npm run example:serpapi
 *
 * Heads-up: each unique leg/date is one billed SerpApi search. This demo prices
 * 6 legs (SFO→JFK, JFK→LHR×2 dates, LHR→SFO×3 dates). Widen the ranges below
 * only if you're comfortable with the extra searches.
 */

import { loadEnv, requireEnv } from '../env';
import { formatPlan } from '../format';
import { planTrip } from '../planner';
import { SerpApiGoogleFlightsProvider } from '../providers/serpapi-google-flights';
import type { TripSpec } from '../types';

loadEnv();

const provider = new SerpApiGoogleFlightsProvider(requireEnv('SERPAPI_KEY'));

const spec: TripSpec = {
  origin: 'SFO',
  stops: [
    { code: 'JFK', label: 'New York', minNights: 2, maxNights: 3 },
    { code: 'LHR', label: 'London', minNights: 3, maxNights: 4 },
  ],
  returnToOrigin: true,
  startDate: '2026-07-15',
  startFlexDays: 1, // widen to sweep more start dates (more searches)
  adults: 1,
  cabin: 'ECONOMY',
};

async function main(): Promise<void> {
  console.log('=== LIVE SerpApi (Google Flights) multi-city plan ===\n');
  const result = await planTrip(provider, spec);
  console.log(formatPlan(spec, result));
  console.log(`\nSerpApi searches run: ${result.queriesRun}`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
