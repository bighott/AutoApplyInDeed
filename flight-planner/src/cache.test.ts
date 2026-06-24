import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CachingProvider } from './cache';
import type { FlightProvider } from './planner';

function counting(): { provider: FlightProvider; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      async searchCheapest() {
        calls++;
        return { price: 100, currency: 'USD' };
      },
    },
  };
}

const q = { origin: 'A', destination: 'B', date: '2026-01-01' };
const opts = { adults: 1, cabin: 'ECONOMY', currency: 'USD' };

test('identical lookups hit the cache', async () => {
  const c = counting();
  const store = new Map();
  let t = 1000;
  const p = new CachingProvider(c.provider, store, { ttlMs: 60_000, namespace: 'x', now: () => t });
  await p.searchCheapest(q, opts);
  await p.searchCheapest(q, opts);
  assert.equal(c.calls(), 1);
  assert.equal(p.countBillable([q], opts), 0);
});

test('cache key includes excludeAirlines (different exclusion = a miss)', () => {
  const c = counting();
  const store = new Map();
  let t = 1000;
  const p = new CachingProvider(c.provider, store, { ttlMs: 60_000, namespace: 'x', now: () => t });
  // prime
  return p.searchCheapest(q, opts).then(() => {
    assert.equal(p.countBillable([q], opts), 0);
    assert.equal(p.countBillable([q], { ...opts, excludeAirlines: ['AA'] }), 1);
  });
});

test('expired entries are billable again', async () => {
  const c = counting();
  const store = new Map();
  let t = 1000;
  const p = new CachingProvider(c.provider, store, { ttlMs: 60_000, namespace: 'x', now: () => t });
  await p.searchCheapest(q, opts);
  assert.equal(p.countBillable([q], opts), 0);
  t += 70_000;
  assert.equal(p.countBillable([q], opts), 1);
});
