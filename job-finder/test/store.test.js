'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { openStore } = require('../src/store');
const { normalizeItem, dedupeKey } = require('../src/normalize');

function tmpDb() {
  return path.join(os.tmpdir(), `jobs-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}

function makeJob(over = {}) {
  return normalizeItem('indeed', {
    title: 'Senior Software Engineer',
    company: 'Acme Corp',
    location: 'Remote',
    url: 'https://example.com/job/1',
    ...over,
  });
}

test('dedupeKey is stable and case/whitespace-insensitive', () => {
  const a = dedupeKey('Senior  Engineer', 'Acme', 'Remote');
  const b = dedupeKey('senior engineer', 'acme', 'remote');
  assert.strictEqual(a, b);
  const c = dedupeKey('Senior Engineer', 'Acme', 'New York');
  assert.notStrictEqual(a, c);
});

test('upsert inserts new jobs and dedupes repeats', () => {
  const db = tmpDb();
  const store = openStore(db);
  try {
    const r1 = store.upsertJobs([makeJob(), makeJob({ title: 'Product Manager' })]);
    assert.strictEqual(r1.inserted, 2);
    assert.strictEqual(r1.skipped, 0);

    // Re-run with one duplicate + one new
    const r2 = store.upsertJobs([makeJob(), makeJob({ title: 'Data Engineer' })]);
    assert.strictEqual(r2.inserted, 1, 'only the Data Engineer is new');
    assert.strictEqual(r2.skipped, 1, 'the SSE is a duplicate');

    assert.strictEqual(store.statusCounts().total, 3);
  } finally {
    store.close();
    fs.rmSync(db, { force: true });
  }
});

test('a seen job is never re-surfaced across runs', () => {
  const db = tmpDb();
  const store = openStore(db);
  try {
    store.upsertJobs([makeJob()]);
    const [job] = store.getNewJobs();
    store.applyScore(job.id, { score: 90, note: 'great', breakdown: {} });
    store.setStatus(job.id, 'applied');

    // Same job scraped again on a later run
    const r = store.upsertJobs([makeJob()]);
    assert.strictEqual(r.inserted, 0);
    assert.strictEqual(r.skipped, 1);

    // Status must remain 'applied' — not reset to 'new'
    assert.strictEqual(store.getById(job.id).status, 'applied');
    assert.strictEqual(store.getNewJobs().length, 0);
  } finally {
    store.close();
    fs.rmSync(db, { force: true });
  }
});

test('status machine + digest eligibility', () => {
  const db = tmpDb();
  const store = openStore(db);
  try {
    store.upsertJobs([
      makeJob({ title: 'A' }),
      makeJob({ title: 'B' }),
      makeJob({ title: 'C' }),
    ]);
    const jobs = store.getNewJobs();
    store.applyScore(jobs[0].id, { score: 90, note: 'x' });
    store.applyScore(jobs[1].id, { score: 65, note: 'y' });
    store.applyScore(jobs[2].id, { score: 40, note: 'z' }); // below threshold

    const eligible = store.getDigestJobs(60);
    assert.strictEqual(eligible.length, 2);
    assert.strictEqual(eligible[0].score, 90, 'ordered by score desc');

    store.markDigested(eligible.map((j) => j.id));
    assert.strictEqual(store.getByStatus('digested').length, 2);
  } finally {
    store.close();
    fs.rmSync(db, { force: true });
  }
});

test('invalid status is rejected', () => {
  const db = tmpDb();
  const store = openStore(db);
  try {
    store.upsertJobs([makeJob()]);
    const [job] = store.getNewJobs();
    assert.throws(() => store.setStatus(job.id, 'bogus'), /invalid status/);
  } finally {
    store.close();
    fs.rmSync(db, { force: true });
  }
});

test('spend tracking accumulates by month', () => {
  const db = tmpDb();
  const store = openStore(db);
  try {
    store.recordRun({ actor: 'indeed', results: 100, cost: 0.01 });
    store.recordRun({ actor: 'linkedin', results: 150, cost: 0.11 });
    const total = store.monthSpend();
    assert.ok(Math.abs(total - 0.12) < 1e-9, `expected ~0.12, got ${total}`);
  } finally {
    store.close();
    fs.rmSync(db, { force: true });
  }
});
