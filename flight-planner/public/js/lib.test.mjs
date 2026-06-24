import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  money, fmtMins, escapeHtml, shortDate, rawTime,
  bagFee, bagEstimate, bagLine, confBadgeHtml, csvCell, pathLabel, legsToCsvRows,
} from './lib.mjs';

test('money / fmtMins / escapeHtml format and stay safe', () => {
  assert.equal(money(412.3, 'USD'), 'USD 412.30');
  assert.equal(money(null, 'USD'), '—');
  assert.equal(fmtMins(630), '10h 30m');
  assert.equal(fmtMins(null), '—');
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('shortDate / rawTime parse loosely', () => {
  assert.equal(shortDate('2026-08-01'), 'Aug 1');
  assert.equal(rawTime('2026-07-17T23:10:00-04:00'), '23:10');
  assert.equal(rawTime(null), '');
});

test('baggage fees: known carrier, default, free, and per-trip estimate', () => {
  assert.equal(bagFee('WN'), 0); // Southwest free
  assert.equal(bagFee('AA'), 40);
  assert.equal(bagFee('ZZ'), 40); // unknown → default
  const it = { total: 500, legs: [{ quote: { airlineCode: 'AA' } }, { quote: { airlineCode: 'WN' } }] };
  assert.equal(bagEstimate(it, 2), 80); // 2 bags × (40 + 0)
  assert.equal(bagEstimate(it, 0), 0);
  assert.match(bagLine(it, 2, 'USD'), /USD 80\.00.*USD 580\.00/);
  assert.equal(bagLine(it, 0, 'USD'), '');
});

test('confidence badge renders tier label and per-source breakdown', () => {
  assert.equal(confBadgeHtml(null), '');
  const html = confBadgeHtml({ tier: 'mixed', sources: [{ name: 'Amadeus', tier: 'live', legs: 2 }, { name: 'Expedia', tier: 'estimate', legs: 1 }] });
  assert.match(html, /Mixed sources/);
  assert.match(html, /Amadeus.*2 legs/);
  assert.match(html, /Expedia.*1 leg\b/);
});

test('csvCell quotes only when needed', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
});

test('legsToCsvRows builds a header + one row per leg', () => {
  const it = { legs: [
    { origin: 'JFK', destination: 'LHR', date: '2026-07-17', quote: { departTime: '08:00', arriveTime: '20:00', airline: 'British Airways', flightNumber: 'BA178', stops: 0, durationLabel: '7h', price: 540, currency: 'USD', bookingUrl: 'http://x' } },
  ] };
  const csv = legsToCsvRows([it], pathLabel);
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^Option,Route,From,To/);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /JFK,LHR,2026-07-17,08:00,20:00,British Airways,BA178,0,7h,540,USD/);
});
