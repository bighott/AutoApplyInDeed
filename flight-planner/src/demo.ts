/**
 * Offline demo: plans a SFO → New York (2–3n) → London (3–4n) → SFO trip with a
 * flexible start, using the deterministic MockFlightProvider so it runs with no
 * network. Doubles as a smoke test (asserts the optimizer returns the minimum).
 *
 *   npm run demo
 */

import assert from 'node:assert';
import { formatPlan } from './format';
import { planTrip } from './planner';
import { MockFlightProvider } from './provider';
import type { TripSpec } from './types';

async function main(): Promise<void> {
  const spec: TripSpec = {
    origin: 'SFO',
    stops: [
      { code: 'JFK', label: 'New York', minNights: 2, maxNights: 3 },
      { code: 'LHR', label: 'London', minNights: 3, maxNights: 4 },
    ],
    returnToOrigin: true,
    startDate: '2026-07-15',
    startFlexDays: 2,
    adults: 1,
    cabin: 'ECONOMY',
  };

  const result = await planTrip(new MockFlightProvider(), spec);
  console.log(formatPlan(spec, result));

  assert(result.best, 'expected a best itinerary');
  for (const it of result.allItineraries) {
    assert(it.total >= result.best.total, 'best must be the global minimum');
  }
  console.log('\n[demo] assertions passed ✓');
}

void main();
