'use strict';

const { normalizeItem } = require('../normalize');

/**
 * Career-site / ATS scraper — fantastic-jobs/career-site-job-listing-api
 * (s3dtSTZSZWFtAVLn5). Direct postings from 175k+ company career sites
 * (Greenhouse, Lever, Ashby, Workday…) with direct apply URLs.
 *
 * Priciest actor ($0.012/job + $0.01/start) — keep limit tight (<=40) and only
 * run a couple times a week (cadence in criteria.yaml).
 */
function buildInput(criteria) {
  const p = criteria.profile || {};
  const s = criteria.sources?.ats || {};

  return {
    titleSearch: [...(p.titles || []), ...(p.keywords_extra || [])].filter(Boolean),
    titleExclusionSearch: p.exclude_titles || [],
    locationSearch: p.remote_only ? ['Remote'] : p.locations || ['Remote'],
    aiWorkArrangementFilter: s.aiWorkArrangementFilter || (p.remote_only ? ['Remote'] : []),
    aiExperienceLevelFilter: s.aiExperienceLevelFilter || [],
    hasSalary: s.hasSalary === true,
    timeRange: s.timeRange || '24h',
    limit: Math.min(Number(s.limit) || 40, 40),
  };
}

async function run(client, criteria, { waitSecs = 300 } = {}) {
  const s = criteria.sources.ats;
  const input = buildInput(criteria);

  const runInfo = await client.actor(s.actor_id).call(input, { waitSecs });
  const { items } = await client.dataset(runInfo.defaultDatasetId).listItems();

  const jobs = items
    .map((it) => normalizeItem('ats', it))
    .filter(Boolean);

  return { jobs, rawCount: items.length };
}

module.exports = { run, buildInput };
