#!/usr/bin/env node
'use strict';

/**
 * `npm run stats` — funnel counts + estimated Apify spend this month.
 * `npm run stats -- --list` also prints the current digest-eligible jobs
 * with their ids (handy for `npm run mark`).
 */

const { openStore } = require('../src/store');
const { loadCriteria } = require('../src/config');
const { maxMonthlySpend } = require('../src/spend');

function main() {
  const list = process.argv.slice(2).includes('--list');
  const criteria = loadCriteria();
  const store = openStore();

  const counts = store.statusCounts();
  const spend = store.monthSpend();
  const cap = maxMonthlySpend(criteria);
  const ym = new Date().toISOString().slice(0, 7);

  console.log('\n📊 Job funnel');
  console.log(`   total seen : ${counts.total}`);
  console.log(`   new        : ${counts.new}`);
  console.log(`   scored     : ${counts.scored}`);
  console.log(`   digested   : ${counts.digested}`);
  console.log(`   applied    : ${counts.applied}`);
  console.log(`   skipped    : ${counts.skipped}`);
  console.log(`   expired    : ${counts.expired}`);

  console.log(`\n💸 Apify spend (${ym})`);
  console.log(`   estimated  : $${spend.toFixed(4)} of $${cap.toFixed(2)} cap  (${((spend / cap) * 100).toFixed(0)}%)`);

  const perActor = store.db
    .prepare("SELECT actor, COUNT(*) runs, SUM(results) results, SUM(cost) cost FROM runs WHERE substr(run_date,1,7)=? GROUP BY actor")
    .all(ym);
  for (const a of perActor) {
    console.log(`   ${a.actor.padEnd(9)}: ${a.runs} run(s), ${a.results || 0} results, ~$${(a.cost || 0).toFixed(4)}`);
  }

  if (list) {
    const min = Number(criteria?.scoring?.min_digest_score) || 60;
    const jobs = store.getDigestJobs(min);
    console.log(`\n📋 Digest-eligible jobs (score ≥ ${min})`);
    if (!jobs.length) console.log('   (none)');
    for (const j of jobs) {
      const fire = j.under10 ? ' 🔥' : '';
      console.log(`   ${j.id.slice(0, 10)}  [${String(j.score).padStart(3)}] ${j.title}${fire} — ${j.company} (${j.status})`);
    }
  }

  console.log('');
  store.close();
}

main();
