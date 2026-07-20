'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

const TIERS = [
  { key: 'excellent', label: 'Excellent', min: 85, badge: '⭐' },
  { key: 'strong', label: 'Strong', min: 70, badge: '✅' },
  { key: 'worth', label: 'Worth a look', min: 60, badge: '👀' },
];

function tierFor(score) {
  return TIERS.find((t) => score >= t.min) || null;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyLink(job) {
  return job.apply_url || job.url || null;
}

/**
 * Build the daily digest from eligible jobs. Writes:
 *   digest/YYYY-MM-DD.html  (self-contained)
 *   digest/latest.md        (summary)
 * Returns { htmlPath, mdPath, count, byTier }.
 */
function generateDigest(store, criteria, { date } = {}) {
  const minScore = Number(criteria?.scoring?.min_digest_score) || 60;
  const day = date || new Date().toISOString().slice(0, 10);
  const jobs = store.getDigestJobs(minScore);

  const grouped = { excellent: [], strong: [], worth: [] };
  for (const j of jobs) {
    const t = tierFor(j.score);
    if (t) grouped[t.key].push(j);
  }

  const html = renderHtml(day, grouped, criteria);
  const md = renderMarkdown(day, grouped);

  if (!fs.existsSync(PATHS.digestDir)) fs.mkdirSync(PATHS.digestDir, { recursive: true });
  const htmlPath = path.join(PATHS.digestDir, `${day}.html`);
  const mdPath = path.join(PATHS.digestDir, 'latest.md');
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(mdPath, md);

  // Advance freshly-shown jobs from scored → digested.
  store.markDigested(jobs.filter((j) => j.status === 'scored').map((j) => j.id));

  return {
    htmlPath,
    mdPath,
    count: jobs.length,
    byTier: {
      excellent: grouped.excellent.length,
      strong: grouped.strong.length,
      worth: grouped.worth.length,
    },
  };
}

function rowHtml(job) {
  const link = applyLink(job);
  const fire = job.under10 ? '<span class="fire" title="Fewer than 10 applicants — low competition">🔥</span>' : '';
  const applyCell = link
    ? `<a class="apply" href="${esc(link)}" target="_blank" rel="noopener">Apply →</a>`
    : '<span class="noapply">no link</span>';
  const src = esc(job.source);
  return `
  <tr>
    <td class="score"><span class="scorebadge s${scoreBucket(job.score)}">${job.score}</span></td>
    <td class="title">
      <div class="t">${esc(job.title)} ${fire}</div>
      <div class="meta">${esc(job.company)} · <span class="src ${src}">${src}</span></div>
    </td>
    <td class="loc">${esc(job.location || '—')}</td>
    <td class="sal">${esc(job.salary || '—')}</td>
    <td class="posted">${esc(job.posted_at || '—')}</td>
    <td class="note">${esc(job.score_note || '')}</td>
    <td class="applycell">${applyCell}</td>
  </tr>`;
}

function scoreBucket(score) {
  if (score >= 85) return 'hi';
  if (score >= 70) return 'mid';
  return 'lo';
}

function sectionHtml(tier, jobs) {
  if (!jobs.length) return '';
  const rows = jobs.map(rowHtml).join('');
  return `
  <section>
    <h2>${tier.badge} ${esc(tier.label)} <span class="count">${jobs.length}</span></h2>
    <table>
      <thead>
        <tr><th>Score</th><th>Role</th><th>Location</th><th>Salary</th><th>Posted</th><th>Why it fits / red flags</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderHtml(day, grouped, criteria) {
  const total = grouped.excellent.length + grouped.strong.length + grouped.worth.length;
  const sections = TIERS.map((t) => sectionHtml(t, grouped[t.key])).join('');
  const empty = total === 0
    ? '<p class="empty">No jobs cleared the score threshold today. Check back tomorrow, or loosen criteria.</p>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job digest — ${esc(day)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f6f7f9; color: #14181f; }
  @media (prefers-color-scheme: dark) { body { background: #0f1115; color: #e6e8ec; } }
  header { padding: 28px 24px 16px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .sub { color: #6b7280; font-size: 13px; }
  main { padding: 0 16px 48px; max-width: 1200px; margin: 0 auto; }
  section { margin: 22px 0; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  .count { display: inline-block; font-size: 12px; color: #6b7280; font-weight: 400; }
  .tablewrap, section { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  @media (prefers-color-scheme: dark) { table { background: #171a21; box-shadow: none; } }
  th, td { text-align: left; padding: 10px 12px; vertical-align: top; border-bottom: 1px solid rgba(128,128,128,.15); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  td.score { width: 52px; }
  .scorebadge { display: inline-block; min-width: 34px; text-align: center; padding: 3px 6px; border-radius: 6px; font-weight: 700; font-size: 13px; color: #fff; }
  .scorebadge.shi { background: #16a34a; }
  .scorebadge.smid { background: #2563eb; }
  .scorebadge.slo { background: #6b7280; }
  td.title .t { font-weight: 600; }
  td.title .meta { color: #6b7280; font-size: 12px; margin-top: 2px; }
  .src { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; padding: 1px 5px; border-radius: 4px; background: rgba(128,128,128,.15); }
  .fire { font-size: 13px; }
  td.note { max-width: 340px; font-size: 13px; color: #374151; }
  @media (prefers-color-scheme: dark) { td.note { color: #c3c7cf; } }
  a.apply { display: inline-block; white-space: nowrap; background: #111827; color: #fff; padding: 6px 12px; border-radius: 7px; text-decoration: none; font-size: 13px; font-weight: 600; }
  a.apply:hover { background: #2563eb; }
  @media (prefers-color-scheme: dark) { a.apply { background: #2563eb; } }
  .noapply { color: #9ca3af; font-size: 12px; }
  .empty { color: #6b7280; padding: 20px; }
  footer { text-align: center; color: #9ca3af; font-size: 12px; padding: 20px; }
</style>
</head>
<body>
<header>
  <h1>Job digest — ${esc(day)}</h1>
  <div class="sub">${total} match${total === 1 ? '' : 'es'} ≥ ${esc(criteria?.scoring?.min_digest_score ?? 60)} · 🔥 = fewer than 10 applicants · links go straight to the employer/ATS application page</div>
</header>
<main>
  ${empty}
  ${sections}
</main>
<footer>Generated by job-finder · you apply manually — nothing was auto-submitted</footer>
</body>
</html>`;
}

function renderMarkdown(day, grouped) {
  const lines = [`# Job digest — ${day}`, ''];
  let any = false;
  for (const tier of TIERS) {
    const jobs = grouped[tier.key];
    if (!jobs.length) continue;
    any = true;
    lines.push(`## ${tier.badge} ${tier.label} (${jobs.length})`, '');
    for (const j of jobs) {
      const link = applyLink(j);
      const fire = j.under10 ? ' 🔥' : '';
      const sal = j.salary ? ` · ${j.salary}` : '';
      const loc = j.location ? ` · ${j.location}` : '';
      const apply = link ? ` — [Apply](${link})` : '';
      lines.push(`- **[${j.score}] ${j.title}${fire}** — ${j.company}${loc}${sal}${apply}`);
      if (j.score_note) lines.push(`  - _${j.score_note}_`);
    }
    lines.push('');
  }
  if (!any) lines.push('_No jobs cleared the score threshold today._', '');
  return lines.join('\n');
}

module.exports = { generateDigest, tierFor };
