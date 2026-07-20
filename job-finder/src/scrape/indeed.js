'use strict';

const { normalizeItem } = require('../normalize');

/**
 * Indeed scraper — valig/indeed-jobs-scraper (TrtlecxAsNRbKl1na).
 * Input: { country, title, location, limit, datePosted }.
 * Cheapest actor ($0.0001/result) — good for live smoke tests with limit=10.
 */
function buildInput(criteria, overrides = {}) {
  const p = criteria.profile || {};
  const s = criteria.sources?.indeed || {};
  const country = (p.countries && p.countries[0]) || 'us';
  const title = (s.query && s.query.trim()) || (p.titles && p.titles[0]) || 'jobs';
  const location = p.remote_only ? 'Remote' : (p.locations && p.locations[0]) || 'Remote';

  return {
    country,
    title,
    location,
    limit: Number(s.limit) || 50,
    datePosted: s.datePosted || '1',
    ...overrides,
  };
}

async function run(client, criteria, { limitOverride, waitSecs = 300 } = {}) {
  const actorId = criteria.sources.indeed.actor_id;
  const input = buildInput(criteria, limitOverride ? { limit: limitOverride } : {});

  const runInfo = await client.actor(actorId).call(input, { waitSecs });
  const { items } = await client.dataset(runInfo.defaultDatasetId).listItems();

  const jobs = items
    .map((it) => normalizeItem('indeed', it))
    .filter(Boolean);

  return { jobs, rawCount: items.length };
}

module.exports = { run, buildInput };
