'use strict';

const { normalizeItem } = require('../normalize');

/**
 * LinkedIn scraper — cheap_scraper/linkedin-job-scraper (2rJKkhh7vjpX7pvjg).
 * Surfaces low-competition roles via filterUnder10Applicants (badged 🔥).
 */
function buildInput(criteria) {
  const p = criteria.profile || {};
  const s = criteria.sources?.linkedin || {};

  const keyword = [...(p.titles || []), ...(p.keywords_extra || [])].filter(Boolean);
  const location = p.remote_only
    ? 'Remote'
    : (p.locations && p.locations[0]) || 'United States';

  return {
    keyword,
    location,
    publishedAt: s.publishedAt || 'past-24h',
    experienceLevel: s.experienceLevel || [],
    workType: s.workType || [],
    jobType: s.jobType || [],
    filterUnder10Applicants: s.filterUnder10Applicants !== false,
    companyExclude: p.exclude_companies || [],
    jobTitleExclude: p.exclude_titles || [],
    // Cap results to control cost ($0.0007/result).
    maxResults: Number(s.max_results) || 150,
  };
}

async function run(client, criteria, { waitSecs = 300 } = {}) {
  const s = criteria.sources.linkedin;
  const input = buildInput(criteria);

  const runInfo = await client.actor(s.actor_id).call(input, { waitSecs });
  const { items } = await client.dataset(runInfo.defaultDatasetId).listItems();

  const under10Default = input.filterUnder10Applicants === true;
  const jobs = items
    .map((it) => normalizeItem('linkedin', it, { under10Default }))
    .filter(Boolean);

  return { jobs, rawCount: items.length };
}

module.exports = { run, buildInput };
