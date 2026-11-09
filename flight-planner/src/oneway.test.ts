import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateDates, oneWayOrigins, oneWayLegQueries, findOneWay, type OneWaySpec } from './oneway';
import { MockFlightProvider } from './provider';

const base: OneWaySpec = {
  origins: ['CLE', 'PIT'],
  destination: 'BOS',
  date: '2027-01-15',
  flexDays: 0,
  adults: 1,
  cabin: 'ECONOMY',
  currency: 'USD',
};

test('candidateDates returns the date plus forward flex days', () => {
  assert.deepEqual(candidateDates('2027-01-15', 0), ['2027-01-15']);
  assert.deepEqual(candidateDates('2027-01-15', 2), ['2027-01-15', '2027-01-16', '2027-01-17']);
});

test('oneWayOrigins de-dupes and upper-cases', () => {
  assert.deepEqual(oneWayOrigins({ ...base, origins: ['cle', 'CLE', 'pit'] }), ['CLE', 'PIT']);
});

test('oneWayLegQueries is one leg per origin×date', () => {
  const legs = oneWayLegQueries({ ...base, flexDays: 1 });
  assert.equal(legs.length, 4); // 2 origins × 2 dates
  assert.ok(legs.every((l) => l.destination === 'BOS'));
});

test('findOneWay returns a best fare per origin, ranked cheapest-first', async () => {
  const r = await findOneWay(new MockFlightProvider(), base);
  assert.equal(r.options.length, 2);
  assert.ok(r.best);
  assert.equal(r.unpriced.length, 0);
  // sorted ascending by price
  assert.ok(r.options[0].quote.price <= r.options[1].quote.price);
  assert.equal(r.best!.quote.price, r.options[0].quote.price);
  for (const o of r.options) assert.equal(o.quote.currency, 'USD');
});

test('flexing checks extra dates and keeps the cheapest', async () => {
  const flat = await findOneWay(new MockFlightProvider(), base);
  const flexed = await findOneWay(new MockFlightProvider(), { ...base, flexDays: 3 });
  assert.ok(flexed.queriesRun > flat.queriesRun); // more lookups when flexing
  // cheapest-with-flex is never worse than the single-date cheapest
  assert.ok((flexed.best!.quote.price) <= (flat.best!.quote.price));
});

test('airline exclusion is threaded through to the provider', async () => {
  const r = await findOneWay(new MockFlightProvider(), base);
  const code = r.best!.quote.airlineCode!;
  const r2 = await findOneWay(new MockFlightProvider(), { ...base, excludeAirlines: [code] });
  // the excluded carrier no longer wins that origin
  const sameOrigin = r2.options.find((o) => o.origin === r.best!.origin);
  assert.notEqual(sameOrigin?.quote.airlineCode, code);
});
