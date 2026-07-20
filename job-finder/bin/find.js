#!/usr/bin/env node
'use strict';

/**
 * `npm run find` — the whole pipeline:
 *   scrape (parallel, fault-tolerant) → normalize → dedupe into SQLite →
 *   score new jobs with Claude → write the ranked digest.
 *
 * Flags:
 *   --force            ignore cadence, run every enabled actor
 *   --only=a,b         run only these actors (indeed|linkedin|ats)
 *   --limit=N          override result limit (smoke test, e.g. --limit=10)
 *   --no-score         scrape + store but skip scoring
 *   --no-digest        skip digest generation
 *   --dry-run          plan + budget check only; launch nothing
 */

const { ApifyClient } = require('apify-client');
const { loadCriteria, apifyToken, maskedApifyToken } = require('../src/config');
const { openStore } = require('../src/store');
const { shouldRunToday } = require('../src/cadence');
const { checkBudget, estimateRunCost, expectedResults, actualRunCost, maxMonthlySpend } = require('../src/spend');
const { resolveJobs } = require('../src/resolve');
const { scoreJobs } = require('../src/score');
const { generateDigest } = require('../src/digest');
const { loadResumeText, hasResume } = require('../src/resume');

const SCRAPERS = {
  indeed: require('../src/scrape/indeed'),
  linkedin: require('../src/scrape/linkedin'),
  ats: require('../src/scrape/ats'),
};
// Order = budget priority (cheapest first gets funded first).
const PRIORITY = ['indeed', 'linkedin', 'ats'];

function parseArgs(argv) {
  const a = { force: false, only: null, limit: null, score: true, digest: true, dryRun: false };
  for (const arg of argv) {
    if (arg === '--force') a.force = true;
    else if (arg === '--no-score') a.score = false;
    else if (arg === '--no-digest') a.digest = false;
    else if (arg === '--dry-run') a.dryRun = true;
    else if (arg.startsWith('--only=')) a.only = arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--limit=')) a.limit = parseInt(arg.slice(8), 10);
  }
  return a;
}

function matchesHardExclude(job, criteria) {
  const p = criteria.profile || {};
  const title = (job.title || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  for (const t of p.exclude_titles || []) {
    if (t && title.includes(String(t).toLowerCase())) return `title contains "${t}"`;
  }
  for (const c of p.exclude_companies || []) {
    if (c && company.includes(String(c).toLowerCase())) return `company "${c}" excluded`;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const criteria = loadCriteria();
  const store = openStore();
  const log = (...m) => console.log(...m);

  log(`\n▶ job-finder — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  log(`  Apify token: ${maskedApifyToken()}`);

  // ---- plan which actors run today ----
  let planned = PRIORITY.filter((key) => {
    const src = criteria.sources?.[key];
    if (!src?.enabled) return false;
    if (args.only) return args.only.includes(key);
    if (args.force) return true;
    return shouldRunToday(src.cadence);
  });

  if (!planned.length) {
    log('  Nothing scheduled to run today (use --force or --only=indeed to run manually).');
    store.close();
    return;
  }

  // ---- budget planning: fund cheapest-first, skip what won't fit ----
  const cap = maxMonthlySpend(criteria);
  let runningTotal = store.monthSpend();
  log(`  Budget: $${runningTotal.toFixed(4)} spent this month, cap $${cap.toFixed(2)}`);

  const toRun = [];
  for (const key of planned) {
    const est = estimateRunCost(criteria, key, expectedResults(criteria, key));
    if (runningTotal + est > cap) {
      log(`  ⏭  skip ${key}: est $${est.toFixed(4)} would exceed cap ($${(runningTotal + est).toFixed(4)} > $${cap.toFixed(2)})`);
      continue;
    }
    runningTotal += est;
    toRun.push({ key, est });
  }

  if (!toRun.length) {
    log('  ⛔ Every planned scrape is over budget. Nothing launched.');
    store.close();
    return;
  }

  log(`  Will run: ${toRun.map((t) => `${t.key} (~$${t.est.toFixed(4)})`).join(', ')}`);

  if (args.dryRun) {
    log('  --dry-run: stopping before launch.');
    store.close();
    return;
  }

  const client = new ApifyClient({ token: apifyToken() });

  // ---- scrape in parallel, tolerate individual failures ----
  const results = await Promise.allSettled(
    toRun.map(async ({ key }) => {
      const scraper = SCRAPERS[key];
      const opts = {};
      if (args.limit && key === 'indeed') opts.limitOverride = args.limit;
      log(`  ↻ scraping ${key}…`);
      const { jobs, rawCount } = await scraper.run(client, criteria, opts);
      const cost = actualRunCost(criteria, key, rawCount);
      store.recordRun({ actor: key, results: rawCount, cost });
      log(`  ✓ ${key}: ${rawCount} raw → ${jobs.length} usable (actual ~$${cost.toFixed(4)})`);
      return { key, jobs };
    })
  );

  let allJobs = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') allJobs = allJobs.concat(r.value.jobs);
    else log(`  ✗ ${toRun[i].key} failed: ${r.reason?.message || r.reason}`);
  }

  if (!allJobs.length) {
    log('  No jobs scraped. Done.');
    return finish(store, criteria, args, log);
  }

  // ---- resolve Indeed redirect links to real employer/ATS URLs ----
  const indeedCount = allJobs.filter((j) => j.source === 'indeed').length;
  if (indeedCount) {
    log(`  resolving ${indeedCount} Indeed apply link(s)…`);
    await resolveJobs(allJobs); // mutates apply_url in place
  }

  // ---- dedupe into SQLite ----
  const { inserted, skipped } = store.upsertJobs(allJobs);
  log(`  stored: ${inserted} new, ${skipped} already seen (deduped)`);

  // ---- hard excludes → mark skipped so they never reach scoring/digest ----
  let excluded = 0;
  for (const job of store.getNewJobs()) {
    const reason = matchesHardExclude(job, criteria);
    if (reason) {
      store.setStatus(job.id, 'skipped');
      excluded++;
    }
  }
  if (excluded) log(`  excluded ${excluded} job(s) by hard filters`);

  return finish(store, criteria, args, log);
}

async function finish(store, criteria, args, log) {
  // ---- scoring ----
  if (args.score) {
    const newJobs = store.getNewJobs();
    if (newJobs.length) {
      if (!hasResume()) {
        log('  ⚠ No resume found in resume/ — scoring on titles/criteria only. Drop a PDF/MD there for best matches.');
      }
      const resumeText = await loadResumeText();
      try {
        const { scored, failed } = await scoreJobs(store, criteria, resumeText, newJobs, { log });
        log(`  scored ${scored}, failed ${failed}`);
      } catch (err) {
        log(`  ⚠ scoring skipped: ${err.message}`);
      }
    } else {
      log('  nothing new to score');
    }
  }

  // ---- digest ----
  if (args.digest) {
    const d = generateDigest(store, criteria);
    log(`  digest: ${d.count} job(s) → ${d.htmlPath}`);
    log(`          Excellent ${d.byTier.excellent} · Strong ${d.byTier.strong} · Worth a look ${d.byTier.worth}`);
    log(`          summary → ${d.mdPath}`);
  }

  const counts = store.statusCounts();
  log(`  funnel: new ${counts.new} · scored ${counts.scored} · digested ${counts.digested} · applied ${counts.applied} · skipped ${counts.skipped}`);
  log('✔ done\n');
  store.close();
}

main().catch((err) => {
  console.error('\n✗ fatal:', err.message);
  process.exit(1);
});
