import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nightsBetween, resolveAnchor, filterStays, sortStays, findStays } from './stays';
import { MockStaysProvider } from './providers/mock-stays';
import type { Stay } from './types';

const CDG: [number, number] = [49.01, 2.55]; // Paris CDG

function stay(p: Partial<Stay>): Stay {
  return { name: 'x', type: 'hotel', pricePerNight: 100, totalPrice: 300, currency: 'USD', rating: 4, reviews: 10, ...p };
}

test('nightsBetween counts nights, min 1', () => {
  assert.equal(nightsBetween('2026-08-01', '2026-08-04'), 3);
  assert.equal(nightsBetween('2026-08-01', '2026-08-01'), 1);
});

test('resolveAnchor prefers explicit coords, falls back to IATA', () => {
  assert.deepEqual(resolveAnchor({ location: 'Paris', lat: 1, lon: 2, checkIn: '', checkOut: '', adults: 1 }), [1, 2]);
  assert.deepEqual(resolveAnchor({ location: 'Paris', anchorCode: 'CDG', checkIn: '', checkOut: '', adults: 1 }), CDG);
  assert.equal(resolveAnchor({ location: 'Nowhere', anchorCode: 'ZZZ', checkIn: '', checkOut: '', adults: 1 }), null);
});

test('filterStays computes distance and honors radius / price / rating / type', () => {
  const near = stay({ name: 'near', lat: 49.0, lon: 2.5, pricePerNight: 120, rating: 4.5 });
  const far = stay({ name: 'far', lat: 48.0, lon: 2.5, pricePerNight: 120, rating: 4.5 }); // ~112 km south
  const pricey = stay({ name: 'pricey', lat: 49.0, lon: 2.5, pricePerNight: 900, rating: 4.5 });
  const lowRated = stay({ name: 'low', lat: 49.0, lon: 2.5, pricePerNight: 120, rating: 3.0 });
  const rental = stay({ name: 'rental', type: 'vacation_rental', lat: 49.0, lon: 2.5, pricePerNight: 120, rating: 4.5 });

  const kept = filterStays([near, far, pricey, lowRated, rental], CDG, {
    radiusKm: 25, maxPrice: 300, minRating: 4, types: ['hotel'],
  });
  assert.deepEqual(kept.map((s) => s.name), ['near']);
  const withDist = filterStays([far], CDG, {});
  assert.ok((withDist[0].distanceKm ?? 0) > 100);
});

test('sortStays: price, rating, distance, and value', () => {
  const a = stay({ name: 'a', pricePerNight: 80, rating: 3.8, distanceKm: 5 });
  const b = stay({ name: 'b', pricePerNight: 200, rating: 4.9, distanceKm: 1 });
  assert.equal(sortStays([a, b], 'price')[0].name, 'a');
  assert.equal(sortStays([a, b], 'rating')[0].name, 'b');
  assert.equal(sortStays([a, b], 'distance')[0].name, 'b');
  assert.equal(sortStays([a, b], 'value').length, 2); // both present, order deterministic
});

test('findStays end-to-end with the mock provider', async () => {
  const r = await findStays(
    new MockStaysProvider(),
    { location: 'Paris', anchorCode: 'CDG', checkIn: '2026-08-01', checkOut: '2026-08-05', adults: 2, includeVacationRentals: true },
    { radiusKm: 50, minRating: 3.5 },
  );
  assert.equal(r.nights, 4);
  assert.deepEqual(r.anchor, CDG);
  assert.ok(r.stays.length > 0 && r.kept === r.stays.length);
  for (const s of r.stays) {
    assert.ok((s.rating ?? 0) >= 3.5);
    assert.ok((s.distanceKm ?? 0) <= 50);
    assert.equal(s.totalPrice, (s.pricePerNight ?? 0) * 4);
  }
  assert.ok(r.stays.some((s) => s.type === 'vacation_rental'));
});
