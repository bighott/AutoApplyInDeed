import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesToLabel, parseDurationToMinutes, googleFlightsUrl } from './util';

test('minutesToLabel formats and guards', () => {
  assert.equal(minutesToLabel(472), '7h 52m');
  assert.equal(minutesToLabel(60), '1h 00m');
  assert.equal(minutesToLabel(0), undefined);
  assert.equal(minutesToLabel(undefined), undefined);
});

test('parseDurationToMinutes', () => {
  assert.equal(parseDurationToMinutes('7h 52m'), 472);
  assert.equal(parseDurationToMinutes('29h 15m'), 1755);
  assert.equal(parseDurationToMinutes('45m'), 45);
  assert.equal(parseDurationToMinutes(''), undefined);
});

test('googleFlightsUrl is a real google flights link', () => {
  const u = googleFlightsUrl('JFK', 'LHR', '2026-07-17');
  assert.match(u, /^https:\/\/www\.google\.com\/travel\/flights\?q=/);
  assert.match(u, /JFK/);
  assert.match(u, /LHR/);
});
