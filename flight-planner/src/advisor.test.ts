import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateAdvisor, planAdvisor, type AdvisorSpec } from './advisor';
import { MockFlightProvider } from './provider';

const base: AdvisorSpec = {
  origins: ['PIT'],
  destinations: [{ code: 'CDG' }, { code: 'FCO' }],
  startDate: '2026-08-01',
  endDate: '2026-08-20',
  totalNights: 10,
  returnToOrigin: true,
  adults: 1,
  cabin: 'ECONOMY',
};

test('DATES mode: every itinerary sums to totalNights', () => {
  const { skeletons } = enumerateAdvisor(base, 80000);
  assert.ok(skeletons.length > 0);
  for (const sk of skeletons) {
    assert.equal(sk.nightsPerStop.reduce((a, b) => a + b, 0), 10);
  }
});

test('MONTH/window mode: per-city ranges, sum fits the window', () => {
  const spec: AdvisorSpec = {
    ...base,
    totalNights: undefined,
    endDate: '2026-08-31',
    destinations: [{ code: 'CDG', minNights: 3, maxNights: 5 }, { code: 'FCO', minNights: 2, maxNights: 4 }],
  };
  const { skeletons } = enumerateAdvisor(spec, 80000);
  assert.ok(skeletons.length > 0);
  for (const sk of skeletons) {
    const sum = sk.nightsPerStop.reduce((a, b) => a + b, 0);
    assert.ok(sum <= 30 && sum >= 5, `sum ${sum} out of range`);
  }
});

test('geographic pruning reduces orders priced', () => {
  const spec: AdvisorSpec = {
    ...base,
    destinations: [{ code: 'ORD' }, { code: 'BCN' }, { code: 'CDG' }], // Chicago + 2 Europe
    totalNights: 9,
  };
  const on = enumerateAdvisor({ ...spec, optimizeGeography: true }, 80000);
  const off = enumerateAdvisor({ ...spec, optimizeGeography: false }, 80000);
  assert.ok(on.ordersPriced < off.ordersPriced);
});

test('planAdvisor finds a route (mock)', async () => {
  const r = await planAdvisor(new MockFlightProvider(), base);
  assert.ok(r.best);
  assert.equal(r.best?.order?.length, 2);
  assert.ok(r.queriesRun > 0);
});

test('planAdvisor rejects a window too short for the minimums', async () => {
  await assert.rejects(() =>
    planAdvisor(new MockFlightProvider(), {
      ...base,
      totalNights: undefined,
      endDate: '2026-08-05',
      destinations: [{ code: 'CDG', minNights: 20 }, { code: 'FCO', minNights: 20 }],
    }),
  );
});

test('planAdvisor rejects totalNights below minimum stays', async () => {
  await assert.rejects(() =>
    planAdvisor(new MockFlightProvider(), {
      ...base,
      totalNights: 1,
      destinations: [{ code: 'CDG', minNights: 3 }, { code: 'FCO', minNights: 3 }],
    }),
  );
});
