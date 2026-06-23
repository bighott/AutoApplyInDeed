/**
 * Typed wrappers over chrome.storage.
 *
 * - chrome.storage.local: durable data (profile, config, jobs, runs, API key).
 * - chrome.storage.session: transient runtime status + kill switch (cleared
 *   when the browser restarts, which is the correct lifetime for those).
 *
 * Every getter returns a sensible default so callers never deal with undefined.
 */

import { STORAGE_KEYS } from './config';
import {
  DailyCounter,
  JobRecord,
  RunConfig,
  RunStats,
  RuntimeStatus,
  UserProfile,
  defaultRunConfig,
  emptyProfile,
  idleStatus,
} from './types';

// --- low-level helpers --------------------------------------------------------

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const obj = await chrome.storage.local.get(key);
  return (obj[key] as T) ?? fallback;
}

async function setLocal(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function getSession<T>(key: string, fallback: T): Promise<T> {
  const obj = await chrome.storage.session.get(key);
  return (obj[key] as T) ?? fallback;
}

async function setSession(key: string, value: unknown): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

// --- profile ------------------------------------------------------------------

export async function getProfile(): Promise<UserProfile> {
  return getLocal(STORAGE_KEYS.profile, emptyProfile());
}

export async function setProfile(profile: UserProfile): Promise<void> {
  await setLocal(STORAGE_KEYS.profile, profile);
}

export async function patchProfile(
  patch: Partial<UserProfile>,
): Promise<UserProfile> {
  const current = await getProfile();
  const next = { ...current, ...patch };
  await setProfile(next);
  return next;
}

// --- run config ---------------------------------------------------------------

export async function getRunConfig(): Promise<RunConfig> {
  return getLocal(STORAGE_KEYS.runConfig, defaultRunConfig());
}

export async function setRunConfig(config: RunConfig): Promise<void> {
  await setLocal(STORAGE_KEYS.runConfig, config);
}

// --- API key (local-only; warn user it is not encrypted at rest) -------------

export async function getApiKey(): Promise<string> {
  return getLocal(STORAGE_KEYS.apiKey, '');
}

export async function setApiKey(key: string): Promise<void> {
  await setLocal(STORAGE_KEYS.apiKey, key.trim());
}

// --- jobs (keyed map persisted as an array for simplicity) -------------------

export async function getJobs(): Promise<JobRecord[]> {
  return getLocal<JobRecord[]>(STORAGE_KEYS.jobs, []);
}

export async function upsertJob(job: JobRecord): Promise<void> {
  const jobs = await getJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  await setLocal(STORAGE_KEYS.jobs, jobs);
}

export async function hasJob(id: string): Promise<boolean> {
  const jobs = await getJobs();
  return jobs.some((j) => j.id === id);
}

export async function clearJobs(): Promise<void> {
  await setLocal(STORAGE_KEYS.jobs, []);
}

// --- runs ---------------------------------------------------------------------

export async function getRuns(): Promise<RunStats[]> {
  return getLocal<RunStats[]>(STORAGE_KEYS.runs, []);
}

export async function upsertRun(run: RunStats): Promise<void> {
  const runs = await getRuns();
  const idx = runs.findIndex((r) => r.runId === run.runId);
  if (idx >= 0) runs[idx] = run;
  else runs.unshift(run); // newest first
  // Keep the log bounded.
  await setLocal(STORAGE_KEYS.runs, runs.slice(0, 100));
}

// --- runtime status (session) -------------------------------------------------

export async function getStatus(): Promise<RuntimeStatus> {
  return getSession(STORAGE_KEYS.runtimeStatus, idleStatus());
}

export async function setStatus(status: RuntimeStatus): Promise<void> {
  await setSession(STORAGE_KEYS.runtimeStatus, status);
}

// --- kill switch (session) ----------------------------------------------------

export async function getKillSwitch(): Promise<boolean> {
  return getSession(STORAGE_KEYS.killSwitch, false);
}

export async function setKillSwitch(value: boolean): Promise<void> {
  await setSession(STORAGE_KEYS.killSwitch, value);
}

// --- daily counter ------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getDailyCounter(): Promise<DailyCounter> {
  const counter = await getLocal<DailyCounter>(STORAGE_KEYS.dailyCounter, {
    date: todayString(),
    applied: 0,
  });
  // Reset automatically on a new local day.
  if (counter.date !== todayString()) {
    const reset = { date: todayString(), applied: 0 };
    await setLocal(STORAGE_KEYS.dailyCounter, reset);
    return reset;
  }
  return counter;
}

export async function incrementDailyCounter(): Promise<DailyCounter> {
  const counter = await getDailyCounter();
  const next = { date: counter.date, applied: counter.applied + 1 };
  await setLocal(STORAGE_KEYS.dailyCounter, next);
  return next;
}
