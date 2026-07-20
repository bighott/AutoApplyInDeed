# job-finder

Automated job **finder** — not an auto-applier. It scrapes LinkedIn, Indeed, and
company career sites (via [Apify](https://apify.com)), deduplicates everything
into SQLite, scores each new job against **your resume + criteria** using Claude,
and produces a ranked **daily digest** with one-click links straight to the real
application page. You review the digest and apply manually.

```
scrape (parallel) → normalize → dedupe (SQLite) → score (Claude) → ranked digest
```

## Quick start

```bash
cd job-finder
npm install
cp .env.example .env          # then fill in APIFY_TOKEN (and optionally ANTHROPIC_API_KEY)
# drop your resume (PDF/MD/TXT) into resume/
# edit criteria.yaml to taste
npm run find                  # run the whole pipeline
open digest/$(date +%F).html  # view today's digest (Linux: xdg-open)
```

Nothing is submitted anywhere — the only outbound calls are to Apify (scraping),
Anthropic/your Claude subscription (scoring), and HEAD/GET requests that resolve
Indeed redirect links to their real destination.

## Configuration

Two files, both read at runtime:

- **`.env`** (gitignored) — `APIFY_TOKEN` (required) and `ANTHROPIC_API_KEY`
  (optional; see Scoring below).
- **`criteria.yaml`** — titles, locations, salary floor, dealbreakers, per-source
  cadence & caps, and the budget guardrail. It's heavily commented; edit freely.

Your resume goes in **`resume/`** (gitignored). PDF, Markdown, or plain text; drop
more than one file and they're concatenated.

## Commands

| Command | What it does |
| --- | --- |
| `npm run find` | Full pipeline: scrape → dedupe → score → digest |
| `npm run find -- --force` | Ignore cadence; run every enabled actor now |
| `npm run find -- --only=indeed --limit=10` | Cheap live smoke test (Indeed only, 10 results) |
| `npm run find -- --dry-run` | Show the plan + budget check, launch nothing |
| `npm run find -- --no-score` | Scrape + store only |
| `npm run mark <job-id> applied` | Mark a job applied/skipped/expired so it leaves the digest |
| `npm run stats` | Funnel counts + estimated Apify spend this month |
| `npm run stats -- --list` | Also list digest-eligible jobs with their ids |
| `npm test` | Unit tests (dedupe, status machine, spend, scoring parse) |

`--limit`, `--only`, etc. come after `--` so npm passes them through to the script.
Job ids appear in `npm run stats -- --list`; a 6+ char prefix works for `mark`.

## Scoring

Each new job is scored **0–100** against your resume + criteria with this rubric:

| Weight | Dimension |
| --- | --- |
| 40% | Skills match |
| 20% | Seniority fit |
| 15% | Location / remote fit |
| 15% | Salary fit |
| 10% | Company signal |

Jobs that clearly violate a dealbreaker are capped at 25. Every job also gets a
two-sentence *why it fits / red flags* note. Jobs are scored in batches (default
15) to cut cost.

**Provider** (`scoring.provider` in criteria.yaml):
- `auto` (default) — use the Anthropic API if `ANTHROPIC_API_KEY` is set,
  otherwise shell out to `claude -p` (headless Claude Code) so scoring runs on
  your existing Claude subscription.
- `anthropic` / `claude-cli` — force one path.

## Digest

`npm run find` writes:
- `digest/YYYY-MM-DD.html` — self-contained, dark-mode aware, grouped into
  **Excellent (85+) / Strong (70–84) / Worth a look (60–69)**, sorted by score.
  LinkedIn roles with **fewer than 10 applicants get a 🔥 badge**.
- `digest/latest.md` — a plain-text summary of the same.

Every **Apply** link is the resolved employer/ATS URL, never a tracking redirect.

## Budget guardrail (Apify free tier)

The Apify free tier gives ~$5/month of credit. `src/spend.js` estimates the cost
of each run from result counts and **refuses to launch a scrape** if
month-to-date estimated spend + this run would exceed `budget.max_monthly_spend`
(default **$4.50**). When several actors are due the same day, the cheapest are
funded first and any that won't fit are skipped with a logged reason.

Default cadence (configurable per source in `criteria.yaml`):

| Source | Actor | Cadence | Cap | Price |
| --- | --- | --- | --- | --- |
| Indeed | `valig/indeed-jobs-scraper` | daily | 200 | $0.0001/result |
| LinkedIn | `cheap_scraper/linkedin-job-scraper` | daily | 150 | $0.0007/result + $0.005/start |
| Career sites (ATS) | `fantastic-jobs/career-site-job-listing-api` | Mon/Thu | 40 | $0.012/job + $0.01/start |

At these defaults a normal weekday costs ≈ **$0.13** and an ATS day adds ≈ **$0.49**,
comfortably under the cap. Check anytime with `npm run stats`.

## Scheduling (cron)

To run every weekday at 7:00 AM America/New_York and write the digest, add this
crontab line (adjust the absolute path):

```cron
# job-finder — weekdays 7:00 AM America/New_York
0 7 * * 1-5  cd /home/user/AutoApplyInDeed/job-finder && TZ=America/New_York /usr/bin/env npm run find >> digest/cron.log 2>&1
```

Install it with `crontab -e` (paste the line). If your machine's system timezone
isn't America/New_York, the `TZ=` prefix keeps the 7 AM anchored to New York.
The schedule/timezone are also recorded in `criteria.yaml` under `cron:` for
reference. **This project never edits your crontab for you** — you paste it.

## Data model & dedupe

Everything lands in `jobs.db` (SQLite, gitignored). The dedupe identity of a job
is `sha1(lower(title) + company + location)`, so a job you've already seen is
**never re-surfaced**, even across sources or days. Status flow:

```
new → scored → digested → applied | skipped | expired
```

`npm run mark` moves a job to a terminal status so it drops out of future digests.

## Layout

```
job-finder/
├── criteria.yaml        # search + scoring config (edit me)
├── resume/              # drop your resume here (gitignored)
├── digest/              # generated HTML + latest.md (gitignored)
├── jobs.db              # SQLite store (gitignored)
├── .env                 # APIFY_TOKEN, optional ANTHROPIC_API_KEY (gitignored)
├── bin/                 # find.js · mark.js · stats.js
├── src/
│   ├── config.js        # load .env + criteria.yaml
│   ├── resume.js        # parse resume/ (PDF/MD/TXT)
│   ├── normalize.js     # unify actor output + dedupe key
│   ├── scrape/          # linkedin.js · indeed.js · ats.js
│   ├── resolve.js       # redirect → real apply URL
│   ├── store.js         # SQLite: dedupe, status machine, spend
│   ├── spend.js         # budget estimator + guardrail
│   ├── score.js         # Claude scoring (API or claude -p)
│   ├── cadence.js       # which actors run today
│   └── digest.js        # HTML + latest.md
└── test/                # node:test unit tests
```
