'use strict';

const { spawnSync } = require('child_process');

/**
 * Score jobs 0–100 against the resume + criteria using Claude.
 *
 * Rubric (weights): skills 40 · seniority 20 · location/remote 15 · salary 15 ·
 * company signal 10. Each job also gets a 2-sentence "why it fits / red flags".
 *
 * Provider: Anthropic API when ANTHROPIC_API_KEY is set (or provider=anthropic),
 * otherwise headless `claude -p` so scoring runs on the user's subscription.
 */

const RUBRIC = `Score each job from 0-100 using this weighted rubric:
- Skills match (40 pts): how well the job's required skills/responsibilities match the candidate's resume.
- Seniority fit (20 pts): is the level appropriate (not too junior, not out of reach)?
- Location/remote fit (15 pts): does it match the candidate's location & remote preferences?
- Salary fit (15 pts): meets or exceeds the candidate's salary floor (award partial if unknown but plausible).
- Company signal (10 pts): reputable / stable / interesting company; deduct for obvious red flags.`;

function resolveProvider(criteria) {
  const configured = criteria?.scoring?.provider || 'auto';
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (configured === 'anthropic') return 'anthropic';
  if (configured === 'claude-cli') return 'claude-cli';
  return hasKey ? 'anthropic' : 'claude-cli'; // auto
}

function buildPrompt(resumeText, criteria, batch) {
  const p = criteria.profile || {};
  const jobsForModel = batch.map((j, idx) => ({
    ref: idx,
    title: j.title,
    company: j.company,
    location: j.location,
    salary: j.salary || 'not stated',
    posted: j.posted_at || 'unknown',
    description: (j.description || '').slice(0, 2500),
  }));

  const criteriaSummary = {
    target_titles: p.titles || [],
    also_interested_in: p.keywords_extra || [],
    locations: p.locations || [],
    remote_only: !!p.remote_only,
    salary_floor: p.salary_floor || null,
    currency: p.currency || 'USD',
    seniority: p.seniority || [],
    dealbreakers: p.dealbreakers || [],
  };

  return `You are a meticulous job-matching assistant. Score each job for how well it fits THIS candidate.

${RUBRIC}

Dealbreakers (if a job clearly violates one, cap its score at 25 and name it as a red flag): ${JSON.stringify(criteriaSummary.dealbreakers)}

=== CANDIDATE CRITERIA ===
${JSON.stringify(criteriaSummary, null, 2)}

=== CANDIDATE RESUME ===
${resumeText ? resumeText.slice(0, 12000) : '(no resume provided — score primarily on titles/criteria above)'}

=== JOBS TO SCORE ===
${JSON.stringify(jobsForModel, null, 2)}

Return ONLY a JSON array, no markdown fences, no prose. One object per job:
[
  {
    "ref": 0,
    "score": 87,
    "breakdown": { "skills": 34, "seniority": 18, "location": 15, "salary": 12, "company": 8 },
    "note": "Two sentences max: why it fits, then any red flags."
  }
]
Every "ref" from the input must appear exactly once. "score" must equal the sum of the breakdown values (0-100).`;
}

async function callAnthropic(prompt, { model, apiKey }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('');
}

function callClaudeCli(prompt) {
  const proc = spawnSync('claude', ['-p'], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180000,
  });
  if (proc.error) {
    if (proc.error.code === 'ENOENT') {
      throw new Error('`claude` CLI not found on PATH. Install Claude Code, or set ANTHROPIC_API_KEY.');
    }
    throw proc.error;
  }
  if (proc.status !== 0) {
    throw new Error(`claude -p exited ${proc.status}: ${(proc.stderr || '').slice(0, 300)}`);
  }
  return proc.stdout || '';
}

/** Pull a JSON array out of a model response that may have stray text/fences. */
function extractJsonArray(text) {
  if (!text) return null;
  let t = text.trim();
  // Strip ```json fences if present.
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Score every job in `jobs`, writing results back through `store`.
 * Returns { scored, failed }.
 */
async function scoreJobs(store, criteria, resumeText, jobs, { log = console.log } = {}) {
  if (!jobs.length) return { scored: 0, failed: 0 };

  const provider = resolveProvider(criteria);
  const model = criteria?.scoring?.model || 'claude-sonnet-5';
  const batchSize = Math.max(1, Math.min(20, Number(criteria?.scoring?.batch_size) || 15));
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (provider === 'anthropic' && !apiKey) {
    throw new Error('scoring.provider=anthropic but ANTHROPIC_API_KEY is not set.');
  }

  log(`  scoring ${jobs.length} job(s) via ${provider}${provider === 'anthropic' ? ` (${model})` : ''}, batch=${batchSize}`);

  let scored = 0;
  let failed = 0;
  const batches = chunk(jobs, batchSize);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const prompt = buildPrompt(resumeText, criteria, batch);
    let text;
    try {
      text = provider === 'anthropic'
        ? await callAnthropic(prompt, { model, apiKey })
        : callClaudeCli(prompt);
    } catch (err) {
      log(`  [batch ${b + 1}/${batches.length}] scoring call failed: ${err.message}`);
      failed += batch.length;
      continue;
    }

    const parsed = extractJsonArray(text);
    if (!Array.isArray(parsed)) {
      log(`  [batch ${b + 1}/${batches.length}] could not parse JSON — skipping batch`);
      failed += batch.length;
      continue;
    }

    const byRef = new Map(parsed.map((r) => [Number(r.ref), r]));
    for (let i = 0; i < batch.length; i++) {
      const r = byRef.get(i);
      const job = batch[i];
      if (!r) {
        failed++;
        continue;
      }
      store.applyScore(job.id, {
        score: clampScore(r.score),
        note: typeof r.note === 'string' ? r.note.trim() : null,
        breakdown: r.breakdown || null,
      });
      scored++;
    }
    log(`  [batch ${b + 1}/${batches.length}] scored ${batch.length}`);
  }

  return { scored, failed };
}

module.exports = { scoreJobs, buildPrompt, extractJsonArray, resolveProvider };
