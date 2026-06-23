/**
 * Background service worker — the orchestrator.
 *
 * Responsibilities:
 *  - Message router for popup/dashboard commands and content-script requests.
 *  - chrome.alarms scheduling for automated runs + manual Run Now.
 *  - The run loop: open/reuse an Indeed tab, scrape search results, match
 *    listings locally, drive the apply flow for "Easily apply" matches, enforce
 *    per-run and daily caps, write JobRecords + RunStats, and stop cleanly.
 *  - Kill switch / Pause / Stop honored between every step.
 *  - Provides Claude screening answers to the apply content script.
 *
 * The service worker is event-driven and may be killed between events; all
 * durable state lives in chrome.storage, and the active run is awaited within a
 * single message handler so it isn't torn down mid-run by idle eviction.
 */

import { answerScreeningQuestion } from '../lib/claude';
import { SCHEDULE_ALARM_NAME } from '../lib/config';
import type {
  AnswerQuestionResult,
  ApplyJobMessage,
  ApplyJobResult,
  ScrapeSearchResult,
} from '../lib/messaging';
import { scoreListing } from '../lib/matcher';
import {
  getApiKey,
  getDailyCounter,
  getKillSwitch,
  getProfile,
  getRunConfig,
  getStatus,
  hasJob,
  incrementDailyCounter,
  setKillSwitch,
  setStatus,
  upsertJob,
  upsertRun,
} from '../lib/storage';
import {
  JobRecord,
  RunConfig,
  RunStats,
  RuntimeStatus,
  ScreeningQuestion,
  UserProfile,
  idleStatus,
  newRunStats,
} from '../lib/types';
import { applicationDelay, paginationDelay, sleep } from '../lib/throttle';

// --- status helpers -----------------------------------------------------------

async function updateStatus(patch: Partial<RuntimeStatus>): Promise<void> {
  const current = await getStatus();
  await setStatus({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

/** Returns true if the run should stop right now (Stop pressed or paused). */
async function aborted(): Promise<boolean> {
  if (await getKillSwitch()) return true;
  const status = await getStatus();
  return status.state === 'paused' || status.state === 'idle';
}

// --- Indeed URL building ------------------------------------------------------

/**
 * Build an Indeed search URL from the run config + page index.
 *
 * MAINTENANCE FLAG: Indeed's query params (remote attribute code, experience
 * level keys) shift over time. If filtering stops working, adjust here.
 */
function buildSearchUrl(config: RunConfig, page: number): string {
  const qParts = [...config.keywords];
  if (config.workMode === 'remote') qParts.push('remote');
  if (config.salaryMin > 0) qParts.push(`$${config.salaryMin}`);
  const q = qParts.join(' ').trim();

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (config.location) params.set('l', config.location);
  if (config.radiusMiles) params.set('radius', String(config.radiusMiles));
  if (config.experienceLevel !== 'any')
    params.set('explvl', config.experienceLevel);
  // Remote-only filter attribute (Indeed "Remote" facet). Fragile — see flag.
  if (config.workMode === 'remote') params.set('sc', '0kf:attr(DSQF7);');
  if (page > 0) params.set('start', String(page * 10));

  return `https://www.indeed.com/jobs?${params.toString()}`;
}

// --- tab helpers --------------------------------------------------------------

async function getOrCreateIndeedTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: '*://*.indeed.com/*' });
  if (tabs.length && tabs[0].id != null) return tabs[0];
  return chrome.tabs.create({ url: 'https://www.indeed.com/', active: false });
}

function navigateAndWait(tabId: number, url: string): Promise<void> {
  return new Promise((resolve) => {
    const listener = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Small settle delay for client-side rendering.
        setTimeout(resolve, 1200);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url });
    // Safety timeout so we never hang forever.
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
}

/** Send a message to a tab, retrying briefly in case the CS isn't ready yet. */
async function sendToTab<T>(tabId: number, message: unknown): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, message);
      return resp as T;
    } catch {
      await sleep(700);
    }
  }
  return null;
}

// --- the run loop -------------------------------------------------------------

let runInProgress = false;

async function startRun(trigger: RunStats['trigger']): Promise<void> {
  if (runInProgress) return;
  runInProgress = true;

  await setKillSwitch(false);
  const runId = `run-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const stats = newRunStats(runId, trigger, startedAt);

  const log = async (
    level: RunStats['events'][number]['level'],
    message: string,
  ) => {
    stats.events.push({ ts: new Date().toISOString(), level, message });
    await upsertRun(stats);
  };

  try {
    const [profile, config, apiKey] = await Promise.all([
      getProfile(),
      getRunConfig(),
      getApiKey(),
    ]);

    // --- preflight gates ---
    const gateError = preflight(profile, config, apiKey);
    if (gateError) {
      await updateStatus({ state: 'error', message: gateError, runId });
      await log('error', gateError);
      stats.finishedAt = new Date().toISOString();
      await upsertRun(stats);
      return;
    }

    await updateStatus({
      state: 'running',
      runId,
      message: 'Starting run…',
      progress: { current: 0, max: config.maxPerRun },
    });
    await log('info', `Run started (${trigger}).`);

    const tab = await getOrCreateIndeedTab();
    if (tab.id == null) throw new Error('Could not open an Indeed tab.');
    const tabId = tab.id;

    // --- session check ---
    await navigateAndWait(tabId, 'https://www.indeed.com/');
    const session = await sendToTab<{
      loggedIn: boolean;
      blocked: boolean;
      reason: string;
    }>(tabId, { type: 'DETECT_SESSION' });
    if (!session || session.blocked || !session.loggedIn) {
      const reason =
        session?.reason || 'Could not confirm Indeed session. Sign in and retry.';
      await updateStatus({ state: 'blocked', message: reason, runId });
      await log('warn', `Run paused: ${reason}`);
      stats.finishedAt = new Date().toISOString();
      await upsertRun(stats);
      return;
    }

    let appliedThisRun = 0;
    let page = 0;
    const maxPages = 10; // safety bound

    pageLoop: while (page < maxPages && appliedThisRun < config.maxPerRun) {
      if (await aborted()) {
        await log('info', 'Run stopped by user.');
        break;
      }

      // Daily cap check.
      const counter = await getDailyCounter();
      if (counter.applied >= config.dailyCap) {
        await log('warn', `Daily cap (${config.dailyCap}) reached. Stopping.`);
        break;
      }

      await updateStatus({ message: `Scanning results page ${page + 1}…` });
      await navigateAndWait(tabId, buildSearchUrl(config, page));

      const scrape = await sendToTab<ScrapeSearchResult>(tabId, {
        type: 'SCRAPE_SEARCH',
        config,
        page,
      });

      if (!scrape || !scrape.ok) {
        const reason = scrape?.error || 'Failed to scrape search results.';
        // If it's a session/bot-check problem, pause; otherwise just stop.
        await updateStatus({ state: 'blocked', message: reason, runId });
        await log('warn', `Scrape blocked: ${reason}`);
        break;
      }

      if (!scrape.listings.length) {
        await log('info', `No listings on page ${page + 1}. Ending scan.`);
        break;
      }

      for (const listing of scrape.listings) {
        if (await aborted()) break pageLoop;
        if (appliedThisRun >= config.maxPerRun) break pageLoop;

        stats.counts.scanned++;

        // Skip already-seen jobs.
        if (await hasJob(listing.id)) continue;

        const match = scoreListing(listing, config, profile);
        const base: JobRecord = {
          id: listing.id,
          title: listing.title,
          company: listing.company,
          location: listing.location,
          url: listing.url,
          status: 'skipped',
          matchScore: match.score,
          reason: match.reason,
          screeningQuestions: [],
          appliedAt: null,
          runId,
          easilyApply: listing.easilyApply,
        };

        if (!match.passed) {
          stats.counts.skipped++;
          await upsertJob(base);
          await upsertRun(stats);
          continue;
        }

        // Non–Easily-Apply listings can't be auto-submitted.
        if (!listing.easilyApply) {
          const rec: JobRecord = {
            ...base,
            status: 'needs_attention',
            reason: 'External ATS / not "Easily Apply" — apply manually.',
          };
          stats.counts.needsAttention++;
          await upsertJob(rec);
          await upsertRun(stats);
          continue;
        }

        // --- attempt the application ---
        await updateStatus({
          message: `Applying: ${listing.title} @ ${listing.company}`,
          progress: { current: appliedThisRun, max: config.maxPerRun },
        });

        await navigateAndWait(tabId, listing.url);
        const applyMsg: ApplyJobMessage = {
          type: 'APPLY_JOB',
          job: base,
          config,
          profileName: profile.name,
          profileEmail: profile.email,
          profilePhone: profile.phone,
          profileLocation: profile.location,
          resumeDataUrl: profile.resumeDataUrl,
          resumeFileName: profile.resumeFileName,
          resumeMimeType: profile.resumeMimeType,
        };
        const result = await sendToTab<ApplyJobResult>(tabId, applyMsg);

        const rec = applyResultToRecord(base, result);
        await upsertJob(rec);

        switch (rec.status) {
          case 'applied':
            stats.counts.applied++;
            appliedThisRun++;
            await incrementDailyCounter();
            await log('info', `Applied: ${listing.title} @ ${listing.company}`);
            break;
          case 'needs_attention':
            stats.counts.needsAttention++;
            await log('info', `Needs attention: ${rec.reason}`);
            break;
          case 'queued':
            stats.counts.queued++;
            break;
          default:
            stats.counts.failed++;
            await log('warn', `Failed: ${rec.reason}`);
        }
        await upsertRun(stats);

        // Bot-check surfaced mid-apply -> pause the whole run.
        if (result?.outcome.status === 'blocked') {
          await updateStatus({
            state: 'blocked',
            message: result.outcome.reason,
            runId,
          });
          await log('warn', `Blocked mid-run: ${result.outcome.reason}`);
          break pageLoop;
        }

        // Human-like spacing between applications.
        const proceed = await applicationDelay(aborted);
        if (!proceed) break pageLoop;
      }

      if (!scrape.hasNextPage) {
        await log('info', 'No further result pages.');
        break;
      }
      page++;
      const proceed = await paginationDelay(aborted);
      if (!proceed) break;
    }

    stats.finishedAt = new Date().toISOString();
    await upsertRun(stats);

    const finalStatus = await getStatus();
    if (finalStatus.state !== 'blocked') {
      await updateStatus({
        state: 'idle',
        message: `Run complete — applied ${stats.counts.applied}, queued ${stats.counts.needsAttention}, skipped ${stats.counts.skipped}.`,
        runId: null,
        progress: { current: 0, max: 0 },
      });
    }
    await log('info', 'Run finished.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateStatus({ state: 'error', message: msg });
    stats.events.push({
      ts: new Date().toISOString(),
      level: 'error',
      message: msg,
    });
    stats.finishedAt = new Date().toISOString();
    await upsertRun(stats);
  } finally {
    runInProgress = false;
  }
}

function preflight(
  profile: UserProfile,
  config: RunConfig,
  apiKey: string,
): string | null {
  if (!profile.skillsAccepted)
    return 'Accept your resume skills in the dashboard before running.';
  if (!profile.resumeText)
    return 'Upload and parse a resume before running.';
  if (config.screeningMode === 'ai' && !apiKey)
    return 'AI screening mode needs an Anthropic API key (Settings).';
  if (!config.keywords.length)
    return 'Add at least one search keyword in Settings.';
  return null;
}

function applyResultToRecord(
  base: JobRecord,
  result: ApplyJobResult | null,
): JobRecord {
  if (!result || !result.ok) {
    return {
      ...base,
      status: 'failed',
      reason: result?.outcome.reason || 'No response from apply content script.',
      appliedAt: new Date().toISOString(),
    };
  }
  const o = result.outcome;
  if (o.status === 'applied') {
    return {
      ...base,
      status: 'applied',
      reason: o.reason,
      appliedAt: new Date().toISOString(),
    };
  }
  if (o.status === 'needs_attention') {
    return {
      ...base,
      status: 'needs_attention',
      reason: o.reason,
      screeningQuestions: o.questions,
      appliedAt: new Date().toISOString(),
    };
  }
  // blocked / failed both record as failed-ish; blocked handled separately.
  return {
    ...base,
    status: o.status === 'blocked' ? 'needs_attention' : 'failed',
    reason: o.reason,
    appliedAt: new Date().toISOString(),
  };
}

// --- screening Q&A bridge for the apply content script -----------------------

async function handleAnswerQuestion(
  question: ScreeningQuestion,
): Promise<AnswerQuestionResult> {
  try {
    const [apiKey, profile] = await Promise.all([getApiKey(), getProfile()]);
    const ans = await answerScreeningQuestion(apiKey, profile, question);
    return {
      ok: true,
      answer: ans.answer,
      confidence: ans.confidence,
      highStakes: ans.highStakes,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- scheduling ---------------------------------------------------------------

async function syncSchedule(): Promise<void> {
  const config = await getRunConfig();
  await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
  if (config.scheduleEnabled && config.scheduleEveryMinutes > 0) {
    chrome.alarms.create(SCHEDULE_ALARM_NAME, {
      periodInMinutes: config.scheduleEveryMinutes,
      delayInMinutes: config.scheduleEveryMinutes,
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_ALARM_NAME) {
    void startRun('scheduled');
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void setStatus(idleStatus());
  void syncSchedule();
});
chrome.runtime.onStartup.addListener(() => {
  void syncSchedule();
});

// --- message router -----------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'RUN_NOW':
      void (async () => {
        await setKillSwitch(false);
        const status = await getStatus();
        if (status.state === 'running') {
          sendResponse({ ok: false, error: 'A run is already in progress.' });
          return;
        }
        // Kick off without blocking the response.
        void startRun('manual');
        sendResponse({ ok: true });
      })();
      return true;

    case 'PAUSE':
      void (async () => {
        await updateStatus({ state: 'paused', message: 'Paused by user.' });
        sendResponse({ ok: true });
      })();
      return true;

    case 'RESUME':
      void (async () => {
        await setKillSwitch(false);
        await updateStatus({ state: 'idle', message: 'Idle.' });
        sendResponse({ ok: true });
      })();
      return true;

    case 'STOP':
      void (async () => {
        await setKillSwitch(true);
        await updateStatus({
          state: 'idle',
          message: 'Stopped by user.',
          runId: null,
          progress: { current: 0, max: 0 },
        });
        sendResponse({ ok: true });
      })();
      return true;

    case 'GET_STATUS':
      void getStatus().then((s) => sendResponse(s));
      return true;

    case 'SYNC_SCHEDULE':
      void syncSchedule().then(() => sendResponse({ ok: true }));
      return true;

    case 'ANSWER_QUESTION':
      void handleAnswerQuestion(message.question).then(sendResponse);
      return true;

    default:
      return undefined;
  }
});
