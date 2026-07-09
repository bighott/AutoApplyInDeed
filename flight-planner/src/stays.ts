/**
 * Stays orchestrator.
 *
 * Sources return raw candidates; this layer makes every source behave the same:
 * it resolves the radius anchor, computes each property's distance, applies the
 * user's radius / price / rating / type filters, and sorts. The "best value"
 * score balances rating against price so a cheap 3-star doesn't outrank a
 * well-priced 4.5-star.
 */

import { coordsOf, haversineKm } from './airports';
import type {
  AccommodationProvider,
  Stay,
  StayFilters,
  StayQuery,
  StaySearchOpts,
} from './types';

export type StaySort = 'value' | 'price' | 'rating' | 'distance';

export interface StaysResult {
  stays: Stay[];
  /** Anchor coordinates used for radius/distance, if resolved. */
  anchor: [number, number] | null;
  /** Nights in the stay (checkOut − checkIn). */
  nights: number;
  /** How many candidates the source returned before filtering. */
  found: number;
  /** How many remain after the radius/price/rating filters. */
  kept: number;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(checkIn + 'T00:00:00Z');
  const b = Date.parse(checkOut + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Resolve the radius anchor: explicit coords win, else the IATA anchor code. */
export function resolveAnchor(q: StayQuery): [number, number] | null {
  if (typeof q.lat === 'number' && typeof q.lon === 'number') return [q.lat, q.lon];
  if (q.anchorCode) return coordsOf(q.anchorCode) ?? null;
  return null;
}

/** 0–1 value score: rating-forward, penalized by price relative to the set. */
function valueScore(s: Stay, maxPrice: number): number {
  const r = (s.rating ?? 0) / 5; // 0..1
  const p = s.pricePerNight != null && maxPrice > 0 ? s.pricePerNight / maxPrice : 1; // 0..1 (1 = priciest)
  return r * 0.7 + (1 - p) * 0.3;
}

export function sortStays(stays: Stay[], sort: StaySort): Stay[] {
  const priced = stays.filter((s) => s.pricePerNight != null);
  const maxPrice = priced.reduce((m, s) => Math.max(m, s.pricePerNight as number), 0);
  const byPrice = (a: Stay, b: Stay) =>
    (a.pricePerNight ?? Infinity) - (b.pricePerNight ?? Infinity);
  const out = [...stays];
  if (sort === 'price') out.sort(byPrice);
  else if (sort === 'rating') out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byPrice(a, b));
  else if (sort === 'distance') out.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  else out.sort((a, b) => valueScore(b, maxPrice) - valueScore(a, maxPrice)); // 'value'
  return out;
}

/** Attach distances and apply the radius / price / rating / type filters. */
export function filterStays(
  stays: Stay[],
  anchor: [number, number] | null,
  filters: StayFilters,
): Stay[] {
  return stays
    .map((s) => {
      const distanceKm =
        anchor && typeof s.lat === 'number' && typeof s.lon === 'number'
          ? Math.round(haversineKm(anchor, [s.lat, s.lon]) * 10) / 10
          : null;
      return { ...s, distanceKm };
    })
    .filter((s) => {
      if (filters.radiusKm != null && s.distanceKm != null && s.distanceKm > filters.radiusKm) return false;
      if (filters.minPrice != null && s.pricePerNight != null && s.pricePerNight < filters.minPrice) return false;
      if (filters.maxPrice != null && s.pricePerNight != null && s.pricePerNight > filters.maxPrice) return false;
      if (filters.minRating != null && (s.rating ?? 0) < filters.minRating) return false;
      if (filters.types && filters.types.length && !filters.types.includes(s.type)) return false;
      return true;
    });
}

export async function findStays(
  provider: AccommodationProvider,
  q: StayQuery,
  filters: StayFilters = {},
  opts?: Partial<StaySearchOpts>,
): Promise<StaysResult> {
  const searchOpts: StaySearchOpts = {
    adults: opts?.adults ?? q.adults,
    currency: opts?.currency ?? q.currency,
    maxResults: opts?.maxResults ?? 40,
    includeVacationRentals: opts?.includeVacationRentals ?? q.includeVacationRentals,
  };
  const anchor = resolveAnchor(q);
  // Hand the provider the resolved anchor so location-agnostic sources (mock,
  // and coordinate-based APIs) center on the same point the filter measures from.
  const providerQuery = anchor ? { ...q, lat: anchor[0], lon: anchor[1] } : q;
  const raw = await provider.searchStays(providerQuery, searchOpts);
  const kept = filterStays(raw, anchor, filters);
  return {
    stays: sortStays(kept, 'value'),
    anchor,
    nights: nightsBetween(q.checkIn, q.checkOut),
    found: raw.length,
    kept: kept.length,
  };
}
