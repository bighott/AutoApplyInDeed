import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeForAirlineName, airlineCodesFromLabel, AIRLINES } from './airlines';

test('codeForAirlineName resolves known names', () => {
  assert.equal(codeForAirlineName('Delta'), 'DL');
  assert.equal(codeForAirlineName('British Airways'), 'BA');
  assert.equal(codeForAirlineName('Icelandair'), 'FI');
  assert.equal(codeForAirlineName('Not An Airline'), undefined);
  assert.equal(codeForAirlineName(undefined), undefined);
});

test('airlineCodesFromLabel handles codes, names, and combined labels', () => {
  assert.deepEqual(airlineCodesFromLabel('BA'), ['BA']);
  assert.deepEqual(airlineCodesFromLabel('Delta/Virgin Atlantic').sort(), ['DL', 'VS']);
  assert.deepEqual(airlineCodesFromLabel('American, Delta').sort(), ['AA', 'DL']);
  assert.deepEqual(airlineCodesFromLabel(''), []);
});

test('AIRLINES list is de-duplicated by code', () => {
  const codes = AIRLINES.map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length);
});
