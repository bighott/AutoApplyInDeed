'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeItem } = require('../src/normalize');
const { shouldRunToday } = require('../src/cadence');
const { estimateRunCost, checkBudget } = require('../src/spend');
const { extractJsonArray } = require('../src/score');

test('normalizeItem maps varied field names', () => {
  const j = normalizeItem('linkedin', {
    jobTitle: 'Staff Engineer',
    companyName: 'Globex',
    formattedLocation: 'Remote (US)',
    jobUrl: 'https://linkedin.com/jobs/1',
    salaryText: '$180k–$220k',
    publishedAt: '2026-07-19',
    descriptionText: 'Build things.',
  });
  assert.strictEqual(j.title, 'Staff Engineer');
  assert.strictEqual(j.company, 'Globex');
  assert.strictEqual(j.location, 'Remote (US)');
  assert.strictEqual(j.salary, '$180k–$220k');
  assert.ok(j.id.length === 40, 'sha1 hex id');
});

test('normalizeItem drops unusable records (no title/company)', () => {
  assert.strictEqual(normalizeItem('indeed', { location: 'Remote' }), null);
});

test('under-10-applicants flag', () => {
  const withCount = normalizeItem('linkedin', { title: 'A', company: 'B', applicantsCount: 4 });
  assert.strictEqual(withCount.under10, 1);
  const many = normalizeItem('linkedin', { title: 'A', company: 'B', applicantsCount: 50 });
  assert.strictEqual(many.under10, 0);
  const flagged = normalizeItem('linkedin', { title: 'A', company: 'B' }, { under10Default: true });
  assert.strictEqual(flagged.under10, 1);
});

test('cadence scheduling', () => {
  const mon = new Date('2026-07-20T12:00:00'); // Monday
  const tue = new Date('2026-07-21T12:00:00'); // Tuesday
  assert.strictEqual(shouldRunToday('daily', mon), true);
  assert.strictEqual(shouldRunToday(['mon', 'thu'], mon), true);
  assert.strictEqual(shouldRunToday(['mon', 'thu'], tue), false);
  assert.strictEqual(shouldRunToday('weekdays', new Date('2026-07-25T12:00:00')), false); // Saturday
});

test('cost estimate matches pricing', () => {
  const criteria = {
    budget: { pricing: { indeed: { per_result: 0.0001, per_start: 0 }, ats: { per_result: 0.012, per_start: 0.01 } } },
  };
  assert.ok(Math.abs(estimateRunCost(criteria, 'indeed', 200) - 0.02) < 1e-9);
  assert.ok(Math.abs(estimateRunCost(criteria, 'ats', 40) - 0.49) < 1e-9);
});

test('budget guard refuses runs over the cap', () => {
  const criteria = {
    budget: { max_monthly_spend: 0.05, pricing: { ats: { per_result: 0.012, per_start: 0.01 } } },
    sources: { ats: { limit: 40 } },
  };
  const fakeStore = { monthSpend: () => 0 };
  const res = checkBudget(criteria, fakeStore, 'ats');
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /over the/);
});

test('extractJsonArray tolerates fences and prose', () => {
  const out = extractJsonArray('Here you go:\n```json\n[{"ref":0,"score":88}]\n```\nDone.');
  assert.deepStrictEqual(out, [{ ref: 0, score: 88 }]);
  assert.strictEqual(extractJsonArray('no json here'), null);
});
