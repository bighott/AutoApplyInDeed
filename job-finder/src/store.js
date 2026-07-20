'use strict';

const Database = require('better-sqlite3');
const { PATHS } = require('./config');

const VALID_STATUSES = ['new', 'scored', 'digested', 'applied', 'skipped', 'expired'];

/**
 * Open (and migrate) the jobs database. Pass a path to use a different file —
 * handy for tests. Returns a thin wrapper with the operations the pipeline needs.
 */
function openStore(dbPath = PATHS.db) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);

  return {
    db,

    /**
     * Insert normalized jobs, skipping any id we've already seen. Returns
     * { inserted, skipped } and never re-surfaces an existing job.
     */
    upsertJobs(jobs) {
      const now = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO jobs (
          id, source, title, company, location, salary, posted_at,
          url, apply_url, description, under10, raw, status,
          first_seen, last_seen
        ) VALUES (
          @id, @source, @title, @company, @location, @salary, @posted_at,
          @url, @apply_url, @description, @under10, @raw, 'new',
          @now, @now
        )
        ON CONFLICT(id) DO UPDATE SET last_seen = @now
      `);

      let inserted = 0;
      let skipped = 0;
      const tx = db.transaction((rows) => {
        for (const j of rows) {
          const before = db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(j.id);
          insert.run({
            id: j.id,
            source: j.source,
            title: j.title,
            company: j.company,
            location: j.location,
            salary: j.salary ?? null,
            posted_at: j.posted_at ?? null,
            url: j.url ?? null,
            apply_url: j.apply_url ?? null,
            description: j.description ?? null,
            under10: j.under10 ? 1 : 0,
            raw: JSON.stringify(j.raw ?? {}),
            now,
          });
          if (before) skipped++;
          else inserted++;
        }
      });
      tx(jobs);
      return { inserted, skipped };
    },

    getByStatus(status) {
      return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY score DESC').all(status);
    },

    getNewJobs() {
      return db.prepare("SELECT * FROM jobs WHERE status = 'new'").all();
    },

    /** Apply a Claude score + note to a job and advance it to `scored`. */
    applyScore(id, { score, note, breakdown }) {
      db.prepare(`
        UPDATE jobs
        SET score = @score, score_note = @note, score_breakdown = @breakdown,
            status = 'scored', scored_at = @now
        WHERE id = @id
      `).run({
        id,
        score,
        note: note ?? null,
        breakdown: breakdown ? JSON.stringify(breakdown) : null,
        now: new Date().toISOString(),
      });
    },

    setStatus(id, status) {
      if (!VALID_STATUSES.includes(status)) {
        throw new Error(`invalid status "${status}" (expected one of ${VALID_STATUSES.join(', ')})`);
      }
      const info = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
      return info.changes > 0;
    },

    getById(id) {
      return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    },

    /** Jobs eligible for the digest: scored/digested, at/above min score. */
    getDigestJobs(minScore) {
      return db
        .prepare(`
          SELECT * FROM jobs
          WHERE score >= ?
            AND status IN ('scored', 'digested')
          ORDER BY score DESC, under10 DESC
        `)
        .all(minScore);
    },

    markDigested(ids) {
      const stmt = db.prepare("UPDATE jobs SET status = 'digested', digested_at = ? WHERE id = ? AND status = 'scored'");
      const now = new Date().toISOString();
      const tx = db.transaction((list) => list.forEach((id) => stmt.run(now, id)));
      tx(ids);
    },

    statusCounts() {
      const rows = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all();
      const out = {};
      for (const s of VALID_STATUSES) out[s] = 0;
      for (const r of rows) out[r.status] = r.n;
      out.total = Object.values(out).reduce((a, b) => a + b, 0);
      return out;
    },

    // ---- spend tracking ----
    recordRun({ actor, results, cost }) {
      db.prepare(`
        INSERT INTO runs (actor, run_date, results, cost, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run(actor, new Date().toISOString().slice(0, 10), results, cost, new Date().toISOString());
    },

    /** Total estimated Apify spend for the given YYYY-MM prefix (default: now). */
    monthSpend(yearMonth) {
      const ym = yearMonth || new Date().toISOString().slice(0, 7);
      const row = db
        .prepare("SELECT COALESCE(SUM(cost), 0) total FROM runs WHERE substr(run_date,1,7) = ?")
        .get(ym);
      return row.total;
    },

    close() {
      db.close();
    },
  };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      salary TEXT,
      posted_at TEXT,
      url TEXT,
      apply_url TEXT,
      description TEXT,
      under10 INTEGER DEFAULT 0,
      raw TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      score INTEGER,
      score_note TEXT,
      score_breakdown TEXT,
      first_seen TEXT,
      last_seen TEXT,
      scored_at TEXT,
      digested_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score);

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      run_date TEXT NOT NULL,
      results INTEGER,
      cost REAL,
      ts TEXT
    );
  `);
}

module.exports = { openStore, VALID_STATUSES };
