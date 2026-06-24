/**
 * Expedia fare snapshot (agent-pulled via the Expedia flight-search tool on
 * 2026-06-24, travel July 2026, 1 adult, economy, cheapest per leg/date).
 *
 * Expedia's MCP search is agent-only and can't be called from user/server code,
 * so its side of any cross-check is served from this static snapshot. To refresh
 * it, ask the agent to re-pull these legs through the Expedia tool and replace
 * the entries below.
 */

import { StaticFlightProvider } from './provider';
import type { FlightQuote, LegQuery } from './types';

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

export const EXPEDIA_FARES: Array<[LegQuery, FlightQuote]> = [
  q('SFO', 'JFK', '2026-07-15', 183.2, 'American', 7, 1, '7h 52m'),
  q('JFK', 'LHR', '2026-07-17', 314.5, 'Delta/Virgin Atlantic', 9, 0, '6h 55m'),
  q('JFK', 'LHR', '2026-07-18', 284.5, 'British Airways', 0, 0, '6h 55m'),
  q('LHR', 'SFO', '2026-07-20', 1289.63, 'TAP Portugal', 0, 1, '29h 15m'),
  q('LHR', 'SFO', '2026-07-21', 909.33, 'TAP Portugal', 0, 1, '26h 45m'),
  q('LHR', 'SFO', '2026-07-22', 909.33, 'TAP Portugal', 0, 1, '26h 40m'),
];

export const expediaStaticProvider = StaticFlightProvider.fromEntries(EXPEDIA_FARES);
