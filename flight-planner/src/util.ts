/**
 * Small shared helpers: flight-duration formatting/parsing and booking links.
 */

/** 472 -> "7h 52m". */
export function minutesToLabel(total?: number | null): string | undefined {
  if (!total || total <= 0) return undefined;
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** "7h 52m" / "29h 15m" -> minutes; undefined if unparseable. */
export function parseDurationToMinutes(label?: string): number | undefined {
  if (!label) return undefined;
  const h = /(\d+)\s*h/i.exec(label);
  const m = /(\d+)\s*m/i.exec(label);
  if (!h && !m) return undefined;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/**
 * A clickable deep link to a one-way Google Flights search for this leg/date.
 * Works for any provider — the user lands on a real, bookable search.
 */
export function googleFlightsUrl(origin: string, destination: string, date: string): string {
  const q = `Flights from ${origin} to ${destination} on ${date} one way`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}
