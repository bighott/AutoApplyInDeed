/**
 * Deterministic offline accommodation provider — the "Demo" source for Stays.
 *
 * Generates a repeatable spread of hotels and vacation rentals scattered around
 * the anchor coordinates, with varied prices, ratings, and distances, so the UI
 * and filters can be exercised for any location with no key and no cost. Output
 * is a pure function of the query (no randomness), matching MockFlightProvider.
 */

import type { AccommodationProvider, Stay, StayQuery, StaySearchOpts, StayType } from '../types';

const NAMES = [
  'Grand Central', 'Riverside', 'Old Town', 'Harbor View', 'Park Plaza', 'The Meridian',
  'Sunset', 'Cathedral', 'Garden Court', 'Skyline', 'Marble Arch', 'Lakeside',
];
const RENTAL_NAMES = [
  'Cozy loft near the center', 'Sunny 1-bed with balcony', 'Design studio, walkable',
  'Family apartment + parking', 'Rooftop terrace flat', 'Quiet garden hideaway',
];

/** Seed a stream from a string (xmur3), then draw uniform 0..1 (mulberry32). */
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 0..1, well-distributed
  };
}

function nights(checkIn: string, checkOut: string): number {
  const a = Date.parse(checkIn + 'T00:00:00Z');
  const b = Date.parse(checkOut + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export class MockStaysProvider implements AccommodationProvider {
  readonly name = 'Demo stays';

  async searchStays(q: StayQuery, opts: StaySearchOpts): Promise<Stay[]> {
    const currency = opts.currency ?? q.currency ?? 'USD';
    const nts = nights(q.checkIn, q.checkOut);
    const rnd = mulberry32(xmur3(q.location.toLowerCase()));
    const anchorLat = q.lat ?? 0;
    const anchorLon = q.lon ?? 0;
    const wantRentals = opts.includeVacationRentals ?? q.includeVacationRentals ?? false;
    const cap = Math.min(opts.maxResults ?? 24, 24);

    const out: Stay[] = [];
    for (let i = 0; i < cap; i++) {
      // Independent draws so price/rating/distance/angle don't move together.
      const rPrice = rnd(), rRate = rnd(), rDist = rnd(), rAng = rnd();
      const isRental = wantRentals && i % 3 === 0;
      const type: StayType = isRental ? 'vacation_rental' : 'hotel';
      // Prices $60–$420/night, ratings 3.4–4.9, distance 0.3–14 km.
      const per = Math.round(60 + rPrice * 360);
      const rating = Math.round((3.4 + rRate * 1.5) * 10) / 10;
      const distKm = Math.round((0.3 + rDist * 13.7) * 10) / 10;
      // Scatter coordinates roughly distKm away from the anchor.
      const ang = rAng * Math.PI * 2;
      const dLat = (distKm / 111) * Math.cos(ang);
      const dLon = (distKm / 111) * Math.sin(ang);
      out.push({
        name: isRental
          ? RENTAL_NAMES[i % RENTAL_NAMES.length]
          : `${NAMES[i % NAMES.length]} ${q.location} Hotel`,
        type,
        pricePerNight: per,
        totalPrice: per * nts,
        currency,
        rating,
        reviews: 40 + Math.round(rRate * 1800),
        lat: anchorLat + dLat,
        lon: anchorLon + dLon,
        address: `${Math.round(rPrice * 200)} Example St, ${q.location}`,
        amenities: isRental ? ['Kitchen', 'Wifi', 'Self check-in'] : ['Wifi', 'Breakfast', 'Gym'],
        bookingUrl: `https://www.google.com/travel/hotels/${encodeURIComponent(q.location)}`,
        source: this.name,
      });
    }
    return out;
  }
}
