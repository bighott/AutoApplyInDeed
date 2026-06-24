import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, legKey, originsOf, enumerateItineraries, uniqueLegQueries } from './planner';
import type { TripSpec } from './types';

const base: TripSpec = {
  origin: 'SFO',
  origins: ['SFO'],
  stops: [{ code: 'JFK', minNights: 2, maxNights: 3 }],
  returnToOrigin: true,
  startDate: '2026-07-15',
  startFlexDays: 1,
  adults: 1,
  cabin: 'ECONOMY',
};

test('addDays is UTC/DST-safe', () => {
  assert.equal(addDays('2026-07-15', 5), '2026-07-20');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('legKey is stable', () => {
  assert.equal(legKey({ origin: 'A', destination: 'B', date: '2026-01-01' }), 'A|B|2026-01-01');
});

test('originsOf de-dupes and supports single origin', () => {
  assert.deepEqual(originsOf({ ...base, origins: ['SFO', 'SFO', 'OAK'] }), ['SFO', 'OAK']);
  assert.deepEqual(originsOf({ ...base, origins: undefined, origin: 'LAX' }), ['LAX']);
});

test('fixed-order enumeration: night range × return leg', () => {
  const { skeletons } = enumerateItineraries(base);
  assert.equal(skeletons.length, 2); // 2 & 3 nights
  for (const sk of skeletons) {
    assert.equal(sk.legs.length, 2); // SFO->JFK, JFK->SFO
    assert.equal(sk.legs[0].date, '2026-07-15');
  }
});

test('asymmetric multi-origin produces depart≠return options', () => {
  const { skeletons } = enumerateItineraries({ ...base, origins: ['SFO', 'OAK'] });
  assert.ok(skeletons.some((s) => s.origin !== s.returnOrigin));
});

test('window mode (endDate, no max) keeps the trip within the window', () => {
  const spec: TripSpec = {
    ...base,
    stops: [{ code: 'JFK', minNights: 2 }, { code: 'LHR', minNights: 3 }],
    startDate: '2026-07-01',
    endDate: '2026-07-25',
  };
  const { skeletons } = enumerateItineraries(spec);
  assert.ok(skeletons.length > 0);
  for (const sk of skeletons) {
    const last = sk.legs[sk.legs.length - 1].date;
    assert.ok(last <= '2026-07-25', `last leg ${last} should be within window`);
    assert.ok(sk.nightsPerStop.every((n) => n >= 1));
  }
});

test('uniqueLegQueries de-dupes shared legs', () => {
  const legs = [{ origin: 'A', destination: 'B', date: '2026-01-01' }];
  assert.equal(uniqueLegQueries([{ legs }, { legs }]).length, 1);
});
