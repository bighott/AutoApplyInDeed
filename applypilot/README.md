# ApplyPilot

A Manifest V3 Chrome extension that helps a single user **find, rank, and
auto-apply** to Indeed "Easily apply" jobs, with a full tracking dashboard.

> ⚠️ **Read the [Risks & Terms of Service](#-risks--terms-of-service) section
> before using this.** Automating job applications on Indeed may violate
> Indeed's Terms of Service and can get your account flagged or banned. This
> tool is provided for educational use. You are responsible for how you use it.

---

## What it does

1. You upload a resume (PDF or DOCX). ApplyPilot parses it **locally**, sends
   only the extracted text to the Claude API, and shows a **1–10 score**,
   actionable **feedback**, and an extracted **skills** list.
2. You review/edit the skills and click **Accept Skills** (this gates all runs).
3. You set search parameters (keywords, location, work mode, salary floor,
   experience level, exclusions, max-per-run, daily cap, screening mode).
4. You stay logged into Indeed in the same browser. ApplyPilot **detects** your
   existing session — it never stores Indeed credentials.
5. You click **Run Now** (or schedule runs via `chrome.alarms`). The bot opens
   Indeed search pages, scrapes and ranks listings, and auto-submits the
   "Easily apply" ones that pass your match threshold.
6. Everything is logged in the dashboard: **Applied**, **Needs Attention**,
   **Skipped/Failed**, with status, timestamp, company, title, link, and reason.

**Screening questions** are handled per your global + per-run choice:

- **AI Answer** — Claude answers using your profile + resume, then the bot fills
  and submits. High-stakes/ambiguous questions (visa, salary, years of
  experience) can be auto-deferred.
- **Defer** — the job is routed to **Needs Attention** with the captured
  questions for you to answer manually.

Listings on external ATSes (not "Easily apply") go straight to **Needs
Attention** with the reason `external ATS / not "Easily Apply"`.

---

## Architecture

```
applypilot/
  manifest.json                 MV3 manifest
  vite.config.ts                build (via @crxjs/vite-plugin)
  src/
    background/service-worker.ts  alarms, run orchestration, message router, kill-switch
    content/indeed-search.ts      scrape & paginate search results
    content/indeed-apply.ts       drive the Easily-Apply modal, fill fields, submit
    content/dom-selectors.ts      ALL selectors centralized w/ fallback arrays + dated note
    content/session-detect.ts     confirm Indeed login / detect captcha / bot-check
    lib/claude.ts                 Claude API client (resume score, skills, Q&A)
    lib/resume-parser.ts          pdf/docx -> text
    lib/matcher.ts                local heuristic listing score (no Claude calls)
    lib/storage.ts                typed wrappers over chrome.storage
    lib/types.ts                  JobRecord, UserProfile, RunConfig, RunStats, etc.
    lib/throttle.ts               human-like randomized delays + daily caps
    lib/config.ts                 single source for the Claude model name + tunables
    lib/messaging.ts              typed message protocol
    ui/dashboard/                 full-page dashboard (Overview/Applied/Attention/Skipped/Settings)
    ui/popup/                     toolbar popup: status, Run Now, Pause/Stop
```

- **No server.** Everything runs client-side in the browser.
- **No external job APIs.** All Indeed interaction is DOM-based via content
  scripts. (There is no public Indeed API for this; none is fabricated.)
- **Claude model** is read from a single constant — `CLAUDE_MODEL` in
  `src/lib/config.ts` (default: `claude-opus-4-8`). Change it there only.

---

## Install (load unpacked)

**Prerequisites:** Node.js 18+ and a Chromium browser (Chrome/Edge/Brave).

```bash
cd applypilot
npm install
npm run build      # outputs to dist/
```

Then in Chrome:

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select the `applypilot/dist` folder.
4. Pin the ApplyPilot icon. Click it → **Open dashboard**.

For live development with HMR:

```bash
npm run dev
```

…then **Load unpacked** the `dist/` folder Vite generates and reload after
changes (the CRXJS plugin hot-reloads most edits automatically).

### First-run setup

1. **Settings → Anthropic API key**: paste your own key (`sk-ant-...`).
   - Get one at <https://console.anthropic.com>.
   - ⚠️ It is stored in `chrome.storage.local` on this device only and is
     **not encrypted at rest** by the browser.
2. **Settings → Resume**: choose a PDF/DOCX and click **Upload & Analyze**.
   Review the score, feedback, and skills.
3. Edit the skills, then click **Accept Skills**. *Runs are blocked until you
   accept.*
4. Fill in **Profile** and **Search & run parameters**, then **Save settings**.
5. Make sure you are **logged into Indeed** in this browser.
6. Click **Run Now** (popup or dashboard), or enable **Run on a schedule**.

---

## How it works

- The **background service worker** orchestrates each run: it opens/reuses an
  Indeed tab, builds search URLs from your config, asks the search content
  script to scrape each results page, scores every listing **locally** with
  `lib/matcher.ts` (keyword overlap, accepted skills, work mode, salary,
  exclusions), and for passing **Easily-Apply** listings navigates to the job
  and asks the apply content script to drive the modal.
- The **apply content script** fills contact fields, re-attaches your resume,
  and handles screening questions (AI via Claude, or defer). It only reports
  `applied` when Indeed shows a confirmation screen — otherwise it records the
  honest outcome (`failed`/`needs_attention`).
- **Claude** is used for exactly two things: resume scoring/skills, and
  screening-question answers. Listing matching is local to save tokens.

### Anti-ban / safety (built in)

- **Randomized human-like delays** between actions, applications, and page
  loads (`lib/throttle.ts`). No tight loops.
- **Daily cap** and **max-per-run** limits, enforced and auto-reset daily.
- **Kill switch / Pause / Stop** in both the popup and dashboard immediately
  halt the orchestrator (checked between every step and during every delay).
- **Centralized selectors** (`content/dom-selectors.ts`) with fallback arrays
  and a dated comment block — when Indeed changes its DOM, edit only that file.
  If selectors fail, the job is marked `failed` with a reason and the run
  continues; it never hangs (every wait has a timeout + step guard).
- **Logged-out / captcha / bot-check detection** (`content/session-detect.ts`).
  When detected, the whole run pauses and a banner appears — the bot never tries
  to push through a challenge.

### Where Indeed's DOM is likely to change (maintenance flags)

These are the brittle spots; all live in `content/dom-selectors.ts`:

- `SEARCH.card` / `SEARCH.title` — results-card markup (A/B tested often).
- `APPLY.continueButton` / `APPLY.submitButton` — the Smart Apply flow.
- `APPLY.modalRoot` / `APPLY.modalIframe` — Indeed sometimes renders the apply
  flow inside a **cross-origin iframe**, which cannot be reliably auto-driven;
  in that case the job is routed to **Needs Attention** to finish manually.
- `SESSION.botCheck` — captcha / "verify you are human" interstitials.
- Search-URL params in `service-worker.ts → buildSearchUrl` (remote facet code,
  experience-level keys) also drift over time.

---

## How to stop it

Any of these halt ApplyPilot immediately:

- **Toolbar popup → Stop**, or **Pause** (then **Resume** later).
- **Dashboard → Settings → Kill switch → "STOP everything now"**, or the
  **Stop** button in the sidebar.
- Disable **Run on a schedule** in Settings and **Save** (clears the alarm).
- Nuclear option: open `chrome://extensions` and toggle ApplyPilot **off**, or
  **Remove** it. Closing the Indeed tab also stops the current page's automation.

Stopping sets a kill switch in `chrome.storage.session`; the orchestrator checks
it between every action and during every delay, so a run ends within seconds.

---

## ⚠️ Risks & Terms of Service

- **Indeed's Terms of Service generally prohibit automated access, scraping, and
  bot-driven applications.** Using this extension may breach those terms and can
  result in your Indeed account being **rate-limited, flagged, or banned**.
- **Auto-submitting applications is irreversible.** You are sending real
  applications to real employers. Misconfigured keywords or a bad match
  threshold can send applications you didn't intend. Start with a **low
  max-per-run**, **Defer** screening mode, and a **high match threshold**, and
  review the **Applied** tab after every run.
- **AI answers can be wrong.** In AI screening mode, Claude answers as you based
  on your profile/resume. Keep **"Defer high-stakes questions"** on, and never
  rely on it for legally significant questions (work authorization, salary
  commitments, certifications).
- **Your API key is local and unencrypted.** Anyone with access to this Chrome
  profile can read it from `chrome.storage.local`. Remove it from Settings when
  you're done, and treat the machine as trusted-only.
- **Your resume text is sent to the Anthropic API** for scoring and screening
  answers. The original file never leaves the browser except when Indeed itself
  requests it for upload.
- **No warranty.** This is educational software. Indeed can change its DOM at
  any time and break the automation; selectors are centralized so you can fix
  them, but correctness is not guaranteed.

Use responsibly, sparingly, and at your own risk.

---

## License

For personal/educational use. No warranty of any kind.
