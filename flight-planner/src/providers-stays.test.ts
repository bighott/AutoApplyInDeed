import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleHotelsProvider } from './providers/google-hotels';
import { AirbnbRapidApiProvider } from './providers/airbnb-rapidapi';

function stub(map: ((url: string) => any) | any): typeof fetch {
  const fn = async (input: any) => {
    const url = String(input);
    const body = typeof map === 'function' ? map(url) : map;
    return { ok: true, json: async () => body };
  };
  return fn as unknown as typeof fetch;
}
const q = { location: 'Paris', checkIn: '2026-08-01', checkOut: '2026-08-05', adults: 2 };
const opts = { adults: 2, currency: 'USD' };

test('Google Hotels maps properties and separates a rentals query', async () => {
  const hotelResp = {
    properties: [{
      type: 'hotel', name: 'Hotel Lumière', overall_rating: 4.4, reviews: 1200,
      gps_coordinates: { latitude: 48.86, longitude: 2.34 },
      rate_per_night: { lowest: '$180', extracted_lowest: 180 },
      total_rate: { lowest: '$720', extracted_lowest: 720 },
      amenities: ['Wifi', 'Breakfast'], link: 'https://book/1',
      images: [{ thumbnail: 'http://img/1' }],
    }],
  };
  const rentalResp = {
    properties: [{
      type: 'vacation rental', name: 'Marais Loft', overall_rating: 4.8, reviews: 90,
      gps_coordinates: { latitude: 48.86, longitude: 2.36 },
      rate_per_night: { extracted_lowest: 130 }, total_rate: { extracted_lowest: 520 },
    }],
  };
  let calls = 0;
  const fetchImpl = stub((url: string) => { calls++; return url.includes('vacation_rentals=true') ? rentalResp : hotelResp; });
  const p = new GoogleHotelsProvider('key', { fetchImpl });

  const hotelsOnly = await p.searchStays(q, opts);
  assert.equal(hotelsOnly.length, 1);
  assert.equal(hotelsOnly[0].pricePerNight, 180);
  assert.equal(hotelsOnly[0].totalPrice, 720);
  assert.equal(hotelsOnly[0].type, 'hotel');
  assert.equal(hotelsOnly[0].thumbnail, 'http://img/1');
  assert.equal(calls, 1); // no rentals → single search

  const both = await p.searchStays(q, { ...opts, includeVacationRentals: true });
  assert.equal(both.length, 2); // hotel + rental
  assert.ok(both.some((s) => s.type === 'vacation_rental' && s.pricePerNight === 130));
  assert.equal(calls, 3); // 1 (hotelsOnly) + 2 (both = hotels + rentals)
});

test('Google Hotels tolerates an error/empty payload', async () => {
  const p = new GoogleHotelsProvider('key', { fetchImpl: stub({ error: 'no results' }) });
  assert.deepEqual(await p.searchStays(q, opts), []);
});

test('Airbnb scaffold requires a key and host, and maps a generic row shape', async () => {
  assert.throws(() => new AirbnbRapidApiProvider('', { host: 'h' }));
  assert.throws(() => new AirbnbRapidApiProvider('k', { host: '' }));
  const resp = { results: [{ name: 'Sunny flat', price: '$95', rating: 4.7, reviews: 33, lat: 48.85, lng: 2.35, url: 'http://a/1' }] };
  const p = new AirbnbRapidApiProvider('k', { host: 'airbnb13.p.rapidapi.com', fetchImpl: stub(resp) });
  const rows = await p.searchStays(q, opts);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pricePerNight, 95);
  assert.equal(rows[0].rating, 4.7);
  assert.equal(rows[0].type, 'vacation_rental');
  assert.equal(rows[0].bookingUrl, 'http://a/1');
});
