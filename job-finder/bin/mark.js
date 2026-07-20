#!/usr/bin/env node
'use strict';

/**
 * `npm run mark <job-id> <status>` — update a job's status so the digest never
 * shows stale entries. Status is one of: applied | skipped | expired |
 * (also new | scored | digested if you need to reset).
 *
 * Job ids come from the digest (hover/inspect) or `npm run stats --list`.
 * A short id prefix (>= 6 chars) is accepted as long as it's unambiguous.
 */

const { openStore, VALID_STATUSES } = require('../src/store');

function main() {
  const [idArg, statusArg] = process.argv.slice(2);
  if (!idArg || !statusArg) {
    console.error('usage: npm run mark <job-id> <applied|skipped|expired>');
    process.exit(1);
  }
  const status = statusArg.toLowerCase();
  if (!VALID_STATUSES.includes(status)) {
    console.error(`invalid status "${status}". Expected one of: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const store = openStore();

  // Resolve full id or unambiguous prefix.
  let job = store.getById(idArg);
  if (!job && idArg.length >= 6) {
    const matches = store.db
      .prepare('SELECT * FROM jobs WHERE id LIKE ?')
      .all(`${idArg}%`);
    if (matches.length === 1) job = matches[0];
    else if (matches.length > 1) {
      console.error(`ambiguous id prefix "${idArg}" — matches ${matches.length} jobs. Use more characters.`);
      store.close();
      process.exit(1);
    }
  }

  if (!job) {
    console.error(`no job found for id "${idArg}"`);
    store.close();
    process.exit(1);
  }

  store.setStatus(job.id, status);
  console.log(`✓ ${job.title} @ ${job.company} → ${status}  (${job.id.slice(0, 10)})`);
  store.close();
}

main();
