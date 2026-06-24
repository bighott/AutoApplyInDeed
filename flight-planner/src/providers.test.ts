import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TravelpayoutsProvider } from './providers/travelpayouts';
import { AmadeusProvider } from './providers/amadeus';
import { SerpApiGoogleFlightsProvider } from './providers/serpapi-google-flights';
import { MockFlightProvider, StaticFlightProvider } from './provider';

/** Build a fetch stub from a url→response map (or a single response). */
function stub(map: ((url: string) => any) | any): typeof fetch {
  const fn = async (input: any) => {
    const url = String(input);
    const body = typeof map === 'function' ? map(url) : map;
    return { ok: true, json: async () => body };
  };
  return fn as unknown as typeof fetch;
}
const opts = { adults: 1, cabin: 'ECONOMY', currency: 'USD' };
const leg = { origin: 'JFK', destination: 'LHR', date: '2026-07-17' };

test('Travelpayouts maps a fare and parses connection segments', async () => {
  const resp = {
    success: true,
    data: [{
      airline: 'fi', price: 238, transfers: 1, duration: 970,
      departure_at: '2026-07-17T23:10:00-04:00',
      flight_number: '618',
      link: '/search/JFK1707LHR1?t=FI000970JFKKEFLHR_hash_1',
    }],
  };
  const p = new TravelpayoutsProvider('tok', { fetchImpl: stub(resp) });
  const q = await p.searchCheapest(leg, opts);
  assert.equal(q!.price, 238);
  assert.equal(q!.airlineCode, 'FI');
  assert.equal(q!.flightNumber, 'FI618');
  assert.deepEqual(q!.segments!.map((s) => `${s.from}-${s.to}`), ['JFK-KEF', 'KEF-LHR']);
});

test('Amadeus reuses its OAuth token and maps offers + included bags', async () => {
  const offers = {
    data: [{
      price: { total: '412.30', currency: 'USD' }, numberOfBookableSeats: 5,
      travelerPricings: [{ fareDetailsBySegment: [{ includedCheckedBags: { quantity: 1 } }, { includedCheckedBags: { quantity: 1 } }] }],
      itineraries: [{ duration: 'PT10H30M', segments: [
        { carrierCode: 'DL', number: '100', departure: { iataCode: 'JFK', at: '2026-07-17T08:00' }, arrival: { iataCode: 'BOS', at: '2026-07-17T13:00' } },
        { carrierCode: 'DL', number: '200', departure: { iataCode: 'BOS', at: '2026-07-17T14:00' }, arrival: { iataCode: 'LHR', at: '2026-07-17T18:30' } },
      ] }],
    }],
  };
  let auth = 0;
  const fetchImpl = stub((url: string) => { if (url.includes('oauth2/token')) { auth++; return { access_token: 'T', expires_in: 1799 }; } return offers; });
  const p = new AmadeusProvider('id', 'secret', { fetchImpl });
  const q = await p.searchCheapest(leg, opts);
  assert.equal(q!.price, 412.3);
  assert.equal(q!.airlineCode, 'DL');
  assert.equal(q!.flightNumber, 'DL100');
  assert.equal(q!.stops, 1);
  assert.equal(q!.includedBags, 1);
  await p.searchCheapest({ ...leg, date: '2026-07-18' }, opts);
  assert.equal(auth, 1); // token cached across searches
});

test('SerpApi picks cheapest and excludes filtered airlines', async () => {
  const data = {
    best_flights: [{ price: 300, total_duration: 420, flights: [{ airline: 'British Airways', flight_number: 'BA 178', departure_airport: { id: 'JFK' }, arrival_airport: { id: 'LHR' } }] }],
    other_flights: [{ price: 250, total_duration: 440, flights: [{ airline: 'American', flight_number: 'AA 100', departure_airport: { id: 'JFK' }, arrival_airport: { id: 'LHR' } }] }],
  };
  const p = new SerpApiGoogleFlightsProvider('key', { fetchImpl: stub(data) });
  const cheapest = await p.searchCheapest(leg, opts);
  assert.equal(cheapest!.price, 250); // American is cheaper
  const noAA = await p.searchCheapest(leg, { ...opts, excludeAirlines: ['AA'] });
  assert.equal(noAA!.price, 300); // AA excluded → BA
});

test('Mock honors airline exclusion and returns a real code', async () => {
  const m = new MockFlightProvider();
  const q1 = await m.searchCheapest(leg, opts);
  assert.match(q1!.airlineCode!, /^[A-Z]{2}$/);
  const q2 = await m.searchCheapest(leg, { ...opts, excludeAirlines: [q1!.airlineCode!] });
  assert.notEqual(q2!.airlineCode, q1!.airlineCode);
});

test('Static provider filters an excluded airline to null', async () => {
  const s = StaticFlightProvider.fromEntries([[leg, { price: 200, currency: 'USD', airline: 'Delta' }]]);
  assert.equal((await s.searchCheapest(leg, opts))!.price, 200);
  assert.equal(await s.searchCheapest(leg, { ...opts, excludeAirlines: ['DL'] }), null);
});
