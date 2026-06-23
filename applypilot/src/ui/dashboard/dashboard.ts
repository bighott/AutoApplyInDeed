/**
 * Full-page dashboard.
 *
 * Tabs: Overview, Applied, Needs Attention, Skipped, Settings.
 * - Settings drives the whole pipeline: resume upload+parse+Claude scoring,
 *   the Accept-Skills gate, profile, run params, schedule, API key, kill switch.
 * - All data comes from chrome.storage; the UI live-updates via the storage
 *   change listener so it reflects runs as they happen.
 */

import { analyzeResume } from '../../lib/claude';
import { STORAGE_KEYS } from '../../lib/config';
import type { CommandMessage } from '../../lib/messaging';
import { parseResume } from '../../lib/resume-parser';
import {
  getApiKey,
  getJobs,
  getProfile,
  getRunConfig,
  getRuns,
  getStatus,
  patchProfile,
  setApiKey,
  setKillSwitch,
  setProfile,
  setRunConfig,
} from '../../lib/storage';
import {
  ExperienceLevel,
  JobRecord,
  RunConfig,
  RunStats,
  RuntimeStatus,
  ScreeningMode,
  UserProfile,
  WorkMode,
  idleStatus,
} from '../../lib/types';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const val = (id: string) => ($(id) as HTMLInputElement).value;
const setVal = (id: string, v: string | number) =>
  (($(id) as HTMLInputElement).value = String(v));
const checked = (id: string) => ($(id) as HTMLInputElement).checked;
const setChecked = (id: string, v: boolean) =>
  (($(id) as HTMLInputElement).checked = v);

// Working copy of skills while editing (before Accept).
let workingSkills: string[] = [];

function send(message: CommandMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

// --- tab switching ------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document
      .querySelectorAll('.panel')
      .forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// --- run controls -------------------------------------------------------------

$('run-btn').addEventListener('click', () => send({ type: 'RUN_NOW' }));
$('pause-btn').addEventListener('click', async () => {
  const status = await getStatus();
  send({ type: status.state === 'paused' ? 'RESUME' : 'PAUSE' });
});
$('stop-btn').addEventListener('click', () => send({ type: 'STOP' }));
$('kill-btn').addEventListener('click', async () => {
  await setKillSwitch(true);
  send({ type: 'STOP' });
});

// --- status / banner ----------------------------------------------------------

function renderStatus(status: RuntimeStatus): void {
  const badge = $('state-badge');
  badge.textContent = status.state;
  badge.className = `badge ${status.state}`;
  $('status-line').textContent = status.message || status.state;

  const banner = $('banner');
  if (status.state === 'blocked' || status.state === 'error') {
    banner.hidden = false;
    banner.textContent =
      (status.state === 'blocked' ? '⛔ Run paused: ' : '⚠ Error: ') +
      status.message;
  } else {
    banner.hidden = true;
  }
}

// --- resume + analysis --------------------------------------------------------

$('analyze-btn').addEventListener('click', async () => {
  const fileInput = $('resume-file') as HTMLInputElement;
  const file = fileInput.files?.[0];
  const statusEl = $('resume-status');
  if (!file) {
    statusEl.textContent = 'Choose a PDF or DOCX file first.';
    return;
  }
  statusEl.textContent = 'Parsing resume…';
  try {
    const parsed = await parseResume(file);
    await patchProfile({
      resumeText: parsed.text,
      resumeFileName: parsed.fileName,
      resumeDataUrl: parsed.dataUrl,
      resumeMimeType: parsed.mimeType,
    });

    const apiKey = await getApiKey();
    if (!apiKey) {
      statusEl.textContent =
        'Resume parsed. Add an Anthropic API key (section 4) and re-run to score it.';
      return;
    }
    statusEl.textContent = 'Asking Claude to score the resume…';
    const analysis = await analyzeResume(apiKey, parsed.text);
    workingSkills = [...analysis.skills];
    await patchProfile({
      score: analysis.score,
      feedback: analysis.feedback,
      skills: analysis.skills,
      skillsAccepted: false,
    });
    statusEl.textContent = `Parsed "${parsed.fileName}" and scored it.`;
    renderAnalysis(await getProfile());
  } catch (err) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : err}`;
  }
});

function renderAnalysis(profile: UserProfile): void {
  const wrap = $('analysis');
  if (profile.score == null && !profile.skills.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $('resume-score').textContent =
    profile.score != null ? String(profile.score) : '—';

  const fb = $('feedback-list');
  fb.innerHTML = '';
  for (const item of profile.feedback) {
    const li = document.createElement('li');
    li.textContent = item;
    fb.appendChild(li);
  }
  renderSkillChips();
  $('skills-accepted-note').textContent = profile.skillsAccepted
    ? '✓ Skills accepted — runs are unlocked.'
    : 'Skills not yet accepted. Runs are blocked until you Accept.';
}

function renderSkillChips(): void {
  const wrap = $('skills-chips');
  wrap.innerHTML = '';
  workingSkills.forEach((skill, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = skill;
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Remove';
    x.addEventListener('click', () => {
      workingSkills.splice(idx, 1);
      renderSkillChips();
    });
    chip.appendChild(x);
    wrap.appendChild(chip);
  });
}

$('add-skill').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key !== 'Enter') return;
  const input = e.target as HTMLInputElement;
  const v = input.value.trim();
  if (v && !workingSkills.some((s) => s.toLowerCase() === v.toLowerCase())) {
    workingSkills.push(v);
    renderSkillChips();
  }
  input.value = '';
});

$('accept-skills').addEventListener('click', async () => {
  await patchProfile({ skills: [...workingSkills], skillsAccepted: true });
  $('skills-accepted-note').textContent =
    '✓ Skills accepted — runs are unlocked.';
});

// --- settings load/save -------------------------------------------------------

async function loadSettings(): Promise<void> {
  const [profile, config, apiKey] = await Promise.all([
    getProfile(),
    getRunConfig(),
    getApiKey(),
  ]);

  // profile
  setVal('p-name', profile.name);
  setVal('p-email', profile.email);
  setVal('p-phone', profile.phone);
  setVal('p-location', profile.location);
  setVal('p-workauth', profile.workAuth);

  // config
  setVal('c-keywords', config.keywords.join(', '));
  setVal('c-exclude', config.excludeKeywords.join(', '));
  setVal('c-location', config.location);
  setVal('c-workmode', config.workMode);
  setVal('c-radius', config.radiusMiles);
  setVal('c-salary', config.salaryMin);
  setVal('c-explvl', config.experienceLevel);
  setVal('c-threshold', config.matchThreshold);
  setVal('c-maxperrun', config.maxPerRun);
  setVal('c-dailycap', config.dailyCap);
  setVal('c-screening', config.screeningMode);
  setChecked('c-defer-high', config.deferHighStakes);
  setChecked('c-schedule', config.scheduleEnabled);
  setVal('c-schedule-mins', config.scheduleEveryMinutes);

  setVal('api-key', apiKey);

  workingSkills = [...profile.skills];
  renderAnalysis(profile);
}

function csv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

$('save-settings').addEventListener('click', async () => {
  const profile = await getProfile();
  const updatedProfile: UserProfile = {
    ...profile,
    name: val('p-name'),
    email: val('p-email'),
    phone: val('p-phone'),
    location: val('p-location'),
    workAuth: val('p-workauth'),
  };
  await setProfile(updatedProfile);

  const config: RunConfig = {
    keywords: csv(val('c-keywords')),
    excludeKeywords: csv(val('c-exclude')),
    location: val('c-location'),
    workMode: val('c-workmode') as WorkMode,
    radiusMiles: Number(val('c-radius')) || 0,
    salaryMin: Number(val('c-salary')) || 0,
    experienceLevel: val('c-explvl') as ExperienceLevel,
    matchThreshold: clampNum(val('c-threshold'), 0, 100, 45),
    maxPerRun: clampNum(val('c-maxperrun'), 1, 100, 15),
    dailyCap: clampNum(val('c-dailycap'), 1, 500, 40),
    screeningMode: val('c-screening') as ScreeningMode,
    deferHighStakes: checked('c-defer-high'),
    scheduleEnabled: checked('c-schedule'),
    scheduleEveryMinutes: clampNum(val('c-schedule-mins'), 15, 100000, 1440),
  };
  await setRunConfig(config);
  await setApiKey(val('api-key'));

  // Re-arm the alarm to match the saved schedule.
  await send({ type: 'SYNC_SCHEDULE' });

  $('save-note').textContent = 'Saved ✓';
  setTimeout(() => ($('save-note').textContent = ''), 2500);
});

function clampNum(v: string, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// --- overview / tables --------------------------------------------------------

async function renderData(): Promise<void> {
  const [jobs, runs] = await Promise.all([getJobs(), getRuns()]);
  renderOverview(jobs, runs);
  renderApplied(jobs);
  renderAttention(jobs);
  renderSkipped(jobs);
}

function renderOverview(jobs: JobRecord[], runs: RunStats[]): void {
  const counts = {
    applied: jobs.filter((j) => j.status === 'applied').length,
    attention: jobs.filter((j) => j.status === 'needs_attention').length,
    skipped: jobs.filter((j) => j.status === 'skipped').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    total: jobs.length,
  };
  const grid = $('stat-grid');
  grid.innerHTML = '';
  const stats: [string, number][] = [
    ['Applied', counts.applied],
    ['Needs Attention', counts.attention],
    ['Skipped', counts.skipped],
    ['Failed', counts.failed],
    ['Total seen', counts.total],
  ];
  for (const [lbl, num] of stats) {
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `<div class="num">${num}</div><div class="lbl">${lbl}</div>`;
    grid.appendChild(el);
  }

  // Applications-per-day chart (last 7 days).
  const byDay = new Map<string, number>();
  for (const j of jobs) {
    if (j.status === 'applied' && j.appliedAt) {
      const day = j.appliedAt.slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
  }
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const max = Math.max(1, ...days.map((d) => byDay.get(d) || 0));
  const chart = $('chart');
  chart.innerHTML = '';
  for (const d of days) {
    const n = byDay.get(d) || 0;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${(n / max) * 100}%`;
    bar.innerHTML = `<span>${d.slice(5)} · ${n}</span>`;
    chart.appendChild(bar);
  }

  // Recent runs.
  const runsList = $('runs-list');
  runsList.innerHTML = '';
  if (!runs.length) {
    runsList.innerHTML = '<p class="empty">No runs yet.</p>';
    return;
  }
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>
      <th>Started</th><th>Trigger</th><th>Applied</th>
      <th>Attention</th><th>Skipped</th><th>Failed</th><th>Status</th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const r of runs.slice(0, 15)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(r.startedAt).toLocaleString()}</td>
      <td>${r.trigger}</td>
      <td>${r.counts.applied}</td>
      <td>${r.counts.needsAttention}</td>
      <td>${r.counts.skipped}</td>
      <td>${r.counts.failed}</td>
      <td>${r.finishedAt ? 'done' : 'running'}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  runsList.appendChild(table);
}

function jobLink(j: JobRecord): string {
  const safe = j.url ? escapeAttr(j.url) : '#';
  return `<a class="joblink" href="${safe}" target="_blank" rel="noopener">${escapeHtml(
    j.title,
  )}</a>`;
}

function renderTable(
  containerId: string,
  jobs: JobRecord[],
  columns: { head: string; cell: (j: JobRecord) => string }[],
): void {
  const container = $(containerId);
  container.innerHTML = '';
  if (!jobs.length) {
    container.innerHTML = '<p class="empty">Nothing here yet.</p>';
    return;
  }
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>${columns
    .map((c) => `<th>${c.head}</th>`)
    .join('')}</tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const j of jobs) {
    const tr = document.createElement('tr');
    tr.innerHTML = columns.map((c) => `<td>${c.cell(j)}</td>`).join('');
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderApplied(jobs: JobRecord[]): void {
  const applied = jobs
    .filter((j) => j.status === 'applied')
    .sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''));
  renderTable('applied-table', applied, [
    { head: 'Title', cell: jobLink },
    { head: 'Company', cell: (j) => escapeHtml(j.company) },
    { head: 'Location', cell: (j) => escapeHtml(j.location) },
    { head: 'Match', cell: (j) => String(j.matchScore) },
    {
      head: 'Applied',
      cell: (j) =>
        j.appliedAt ? new Date(j.appliedAt).toLocaleString() : '—',
    },
  ]);
}

function renderSkipped(jobs: JobRecord[]): void {
  const items = jobs
    .filter((j) => j.status === 'skipped' || j.status === 'failed')
    .sort((a, b) => b.matchScore - a.matchScore);
  renderTable('skipped-table', items, [
    { head: 'Title', cell: jobLink },
    { head: 'Company', cell: (j) => escapeHtml(j.company) },
    {
      head: 'Status',
      cell: (j) =>
        `<span class="status-pill status-${j.status}">${j.status}</span>`,
    },
    { head: 'Match', cell: (j) => String(j.matchScore) },
    { head: 'Reason', cell: (j) => escapeHtml(j.reason) },
  ]);
}

function renderAttention(jobs: JobRecord[]): void {
  const items = jobs.filter((j) => j.status === 'needs_attention');
  const container = $('attention-list');
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<p class="empty">Nothing needs attention.</p>';
    return;
  }
  for (const j of items) {
    const card = document.createElement('div');
    card.className = 'attn-card';
    const qs = j.screeningQuestions
      .map(
        (q) =>
          `<div class="q"><strong>${escapeHtml(q.question)}</strong>${
            q.options.length
              ? `<br><span class="muted">Options: ${q.options
                  .map(escapeHtml)
                  .join(' · ')}</span>`
              : ''
          }${q.highStakes ? ' <em>(high-stakes)</em>' : ''}</div>`,
      )
      .join('');
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div>
          <strong>${escapeHtml(j.title)}</strong> — ${escapeHtml(j.company)}
          <div class="muted">${escapeHtml(j.location)}</div>
        </div>
        <a class="joblink" href="${escapeAttr(
          j.url || '#',
        )}" target="_blank" rel="noopener">Open job →</a>
      </div>
      <p class="muted">${escapeHtml(j.reason)}</p>
      ${qs}`;
    container.appendChild(card);
  }
}

// --- escaping helpers ---------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

// --- init + live updates ------------------------------------------------------

async function init(): Promise<void> {
  await loadSettings();
  await renderData();
  renderStatus(await getStatus().catch(() => idleStatus()));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[STORAGE_KEYS.jobs] || changes[STORAGE_KEYS.runs])) {
    void renderData();
  }
  if (area === 'local' && changes[STORAGE_KEYS.profile]) {
    const p = changes[STORAGE_KEYS.profile].newValue as UserProfile;
    if (p) {
      workingSkills = [...p.skills];
      renderAnalysis(p);
    }
  }
  if (area === 'session' && changes[STORAGE_KEYS.runtimeStatus]) {
    renderStatus(changes[STORAGE_KEYS.runtimeStatus].newValue as RuntimeStatus);
  }
});

void init();
