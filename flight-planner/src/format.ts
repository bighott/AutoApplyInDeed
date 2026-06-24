/**
 * Human-readable rendering of a PlanResult: the recommended itineraries
 * (cheapest / fastest / best value), the per-leg multi-day price matrix, and the
 * cheapest-first ranking — including total flight time and booking links.
 */

import { originsOf } from './planner';
import type { ItineraryResult, PlanResult, PricedLeg, TripSpec } from './types';
import { minutesToLabel } from './util';

function money(n: number, currency: string): string {
  return `${currency} ${n.toFixed(2)}`;
}

function dur(mins: number | null): string {
  return mins == null ? '—' : (minutesToLabel(mins) ?? '—');
}

function legLine(l: PricedLeg): string {
  if (!l.quote) return `   ${l.origin}→${l.destination} ${l.date}  — no flights found`;
  const q = l.quote;
  const bits = [
    money(q.price, q.currency),
    q.airline ?? '',
    q.stops != null ? `${q.stops} stop${q.stops === 1 ? '' : 's'}` : '',
    q.durationLabel ?? '',
    q.seatsLeft === 0 ? '(sold out at this fare)' : '',
    q.bookingUrl ? `book: ${q.bookingUrl}` : '',
  ].filter(Boolean);
  return `   ${l.origin}→${l.destination} ${l.date}  ${bits.join('  ·  ')}`;
}

function itineraryBlock(title: string, spec: TripSpec, it: ItineraryResult): string[] {
  const lines: string[] = [title];
  lines.push(
    `   From ${it.origin}, start ${it.startDate}, nights: ${spec.stops
      .map((s, i) => `${s.label || s.code} ${it.nightsPerStop[i]}`)
      .join(', ')}`,
  );
  for (const l of it.legs) lines.push(legLine(l));
  lines.push(`   ────────`);
  lines.push(
    `   TOTAL: ${money(it.total, it.currency)}  ·  flight time ${dur(it.totalDurationMinutes)}`,
  );
  return lines;
}

export function formatPlan(spec: TripSpec, result: PlanResult): string {
  const lines: string[] = [];
  const origins = originsOf(spec);
  const originLabel = origins.length > 1 ? `[${origins.join('/')}]` : origins[0];
  const route = [
    originLabel,
    ...spec.stops.map((s) => s.label || s.code),
    ...(spec.returnToOrigin ? [originLabel] : []),
  ].join(' → ');

  lines.push(`Trip: ${route}`);
  if (origins.length > 1) lines.push(`Origins tried: ${origins.join(', ')}`);
  lines.push(
    `Stops: ${spec.stops
      .map((s) => `${s.label || s.code} ${s.minNights}-${s.maxNights}n`)
      .join(', ')}`,
  );
  lines.push(
    `Start ${spec.startDate} (+${Math.max(0, spec.startFlexDays - 1)} flex day(s)), ` +
      `${spec.adults} adult(s), ${spec.cabin}`,
  );
  lines.push(`Unique searches run: ${result.queriesRun}`);
  lines.push('');

  if (!result.best) {
    lines.push('No fully-priceable itinerary found.');
    return lines.join('\n');
  }

  lines.push(...itineraryBlock('★ CHEAPEST', spec, result.best));
  lines.push('');

  // Surface fastest and best-value only when they differ from the cheapest.
  const sameItin = (a: ItineraryResult | null, b: ItineraryResult | null) =>
    a && b && a.origin === b.origin && a.startDate === b.startDate &&
    a.nightsPerStop.join() === b.nightsPerStop.join();
  if (result.fastest && !sameItin(result.fastest, result.best)) {
    lines.push(...itineraryBlock('⚡ FASTEST', spec, result.fastest));
    lines.push('');
  }
  if (
    result.bestValue &&
    !sameItin(result.bestValue, result.best) &&
    !sameItin(result.bestValue, result.fastest)
  ) {
    lines.push(...itineraryBlock('◆ BEST VALUE (price + time)', spec, result.bestValue));
    lines.push('');
  }

  // Per-leg multi-day matrix: cheapest price + time for each leg/date.
  lines.push('Per-leg price matrix (cheapest fare per day):');
  const byRoute = new Map<string, PricedLeg[]>();
  for (const l of result.legGrid) {
    const k = `${l.origin}→${l.destination}`;
    (byRoute.get(k) ?? byRoute.set(k, []).get(k)!).push(l);
  }
  for (const [route2, legs] of byRoute) {
    const cells = legs
      .slice()
      .sort((a, b2) => a.date.localeCompare(b2.date))
      .map((l) =>
        l.quote
          ? `${l.date}: ${money(l.quote.price, l.quote.currency)} (${dur(l.quote.durationMinutes ?? null)})`
          : `${l.date}: —`,
      );
    lines.push(`   ${route2}  ${cells.join('   ')}`);
  }
  lines.push('');

  // Top alternatives.
  lines.push('Cheapest itineraries (top 5):');
  result.allItineraries.slice(0, 5).forEach((it, i) => {
    lines.push(
      `   ${i + 1}. ${money(it.total, it.currency)}  ·  ${dur(it.totalDurationMinutes)}  ·  ` +
        `from ${it.origin}  start ${it.startDate}  nights [${it.nightsPerStop.join(',')}]`,
    );
  });

  return lines.join('\n');
}
