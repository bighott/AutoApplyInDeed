/**
 * Human-readable rendering of a PlanResult: the recommended itinerary, the
 * per-leg multi-day price matrix, and the cheapest-first itinerary ranking.
 */

import type { PlanResult, PricedLeg, TripSpec } from './types';

function money(n: number, currency: string): string {
  return `${currency} ${n.toFixed(2)}`;
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
  ].filter(Boolean);
  return `   ${l.origin}→${l.destination} ${l.date}  ${bits.join('  ·  ')}`;
}

export function formatPlan(spec: TripSpec, result: PlanResult): string {
  const lines: string[] = [];
  const route = [
    spec.origin,
    ...spec.stops.map((s) => s.label || s.code),
    ...(spec.returnToOrigin ? [spec.origin] : []),
  ].join(' → ');

  lines.push(`Trip: ${route}`);
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

  const b = result.best;
  lines.push('★ CHEAPEST ITINERARY');
  lines.push(
    `   Start ${b.startDate}, nights: ${spec.stops
      .map((s, i) => `${s.label || s.code} ${b.nightsPerStop[i]}`)
      .join(', ')}`,
  );
  for (const l of b.legs) lines.push(legLine(l));
  lines.push(`   ────────`);
  lines.push(`   TOTAL: ${money(b.total, b.currency)}`);
  lines.push('');

  // Per-leg multi-day matrix: cheapest price seen for each leg/date.
  lines.push('Per-leg price matrix (the multi-day search):');
  const byRoute = new Map<string, PricedLeg[]>();
  for (const l of result.legGrid) {
    const k = `${l.origin}→${l.destination}`;
    (byRoute.get(k) ?? byRoute.set(k, []).get(k)!).push(l);
  }
  for (const [route2, legs] of byRoute) {
    const cells = legs
      .slice()
      .sort((a, b2) => a.date.localeCompare(b2.date))
      .map((l) => `${l.date}: ${l.quote ? money(l.quote.price, l.quote.currency) : '—'}`);
    lines.push(`   ${route2}  ${cells.join('   ')}`);
  }
  lines.push('');

  // Top alternatives.
  lines.push('Cheapest itineraries (top 5):');
  result.allItineraries.slice(0, 5).forEach((it, i) => {
    lines.push(
      `   ${i + 1}. ${money(it.total, it.currency)}  start ${it.startDate}  ` +
        `nights [${it.nightsPerStop.join(',')}]`,
    );
  });

  return lines.join('\n');
}
