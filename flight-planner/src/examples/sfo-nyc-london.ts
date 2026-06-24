/**
 * LIVE-DATA example: SFO → New York (2–3 nights) → London (3–4 nights) → SFO.
 *
 * The fares below were pulled live via the Expedia flight-search tool on
 * 2026-06-24 (travel July 2026, 1 adult, economy, cheapest per leg/date). They
 * are fed into a StaticFlightProvider so this runs offline and reproducibly —
 * this is exactly the agent-driven path: enumerate the unique legs, price each
 * via Expedia, then let the planner pick the cheapest combination of dates.
 *
 * Prices and seat availability change continuously — re-pull before booking.
 * Run with:  npm run example:live
 */

import { formatPlan } from '../format';
import { planTrip } from '../planner';
import { StaticFlightProvider } from '../provider';
import type { FlightQuote, LegQuery, TripSpec } from '../types';

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

// Cheapest fare returned for each unique (origin, destination, date) leg.
const provider = StaticFlightProvider.fromEntries([
  q('SFO', 'JFK', '2026-07-15', 183.2, 'American', 7, 1, '7h 52m'),
  q('JFK', 'LHR', '2026-07-17', 314.5, 'Delta/Virgin Atlantic', 9, 0, '6h 55m'),
  q('JFK', 'LHR', '2026-07-18', 284.5, 'British Airways', 0, 0, '6h 55m'),
  q('LHR', 'SFO', '2026-07-20', 1289.63, 'TAP Portugal', 0, 1, '29h 15m'),
  q('LHR', 'SFO', '2026-07-21', 909.33, 'TAP Portugal', 0, 1, '26h 45m'),
  q('LHR', 'SFO', '2026-07-22', 909.33, 'TAP Portugal', 0, 1, '26h 40m'),
]);

const spec: TripSpec = {
  origin: 'SFO',
  stops: [
    { code: 'JFK', label: 'New York', minNights: 2, maxNights: 3 },
    { code: 'LHR', label: 'London', minNights: 3, maxNights: 4 },
  ],
  returnToOrigin: true,
  startDate: '2026-07-15',
  startFlexDays: 1, // fixed start; widen to sweep more start dates
  adults: 1,
  cabin: 'ECONOMY',
};

async function main(): Promise<void> {
  const result = await planTrip(provider, spec);
  console.log('=== LIVE-DATA MULTI-CITY PLAN — Expedia fares, July 2026 ===\n');
  console.log(formatPlan(spec, result));
}

void main();
