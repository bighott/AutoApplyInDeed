/**
 * Shared data model for ApplyPilot.
 *
 * These types are the contract between the background service worker, the
 * content scripts, and the dashboard/popup UIs. Everything persisted in
 * chrome.storage is shaped by the interfaces here.
 */

// --- User profile -------------------------------------------------------------

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  /** Work authorization summary, e.g. "US Citizen", "Requires sponsorship". */
  workAuth: string;
  /** Extracted plain text of the uploaded resume. */
  resumeText: string;
  resumeFileName: string;
  /** Base64 data URL of the original resume file, for re-attaching on Indeed. */
  resumeDataUrl?: string;
  /** Resume MIME type (e.g. application/pdf). */
  resumeMimeType?: string;
  /** Accepted skills list (user-reviewed). Must be accepted before any run. */
  skills: string[];
  /** True once the user has reviewed + accepted the skills. Gates runs. */
  skillsAccepted: boolean;
  /** Claude resume score 1–10. */
  score: number | null;
  /** Claude actionable improvement feedback. */
  feedback: string[];
  /**
   * Map of common screening question (normalized) -> preferred answer.
   * Used to answer recurring questions without calling Claude every time.
   */
  freeformAnswers: Record<string, string>;
}

export function emptyProfile(): UserProfile {
  return {
    name: '',
    email: '',
    phone: '',
    location: '',
    workAuth: '',
    resumeText: '',
    resumeFileName: '',
    skills: [],
    skillsAccepted: false,
    score: null,
    feedback: [],
    freeformAnswers: {},
  };
}

// --- Run configuration --------------------------------------------------------

export type WorkMode = 'remote' | 'local' | 'hybrid' | 'any';
export type ExperienceLevel =
  | 'any'
  | 'entry_level'
  | 'mid_level'
  | 'senior_level';
export type ScreeningMode = 'ai' | 'defer';

export interface RunConfig {
  keywords: string[];
  excludeKeywords: string[];
  location: string;
  workMode: WorkMode;
  radiusMiles: number;
  salaryMin: number;
  experienceLevel: ExperienceLevel;
  maxPerRun: number;
  dailyCap: number;
  screeningMode: ScreeningMode;
  /** Minimum match score (0–100) required to attempt a listing. */
  matchThreshold: number;
  /**
   * When screeningMode === 'ai', still defer high-stakes/ambiguous questions
   * (visa, salary expectation, years-of-experience the user lacks).
   */
  deferHighStakes: boolean;
  scheduleEnabled: boolean;
  /** chrome.alarms periodInMinutes (e.g. 1440 = daily). */
  scheduleEveryMinutes: number;
}

export function defaultRunConfig(): RunConfig {
  return {
    keywords: [],
    excludeKeywords: [],
    location: '',
    workMode: 'any',
    radiusMiles: 25,
    salaryMin: 0,
    experienceLevel: 'any',
    maxPerRun: 15,
    dailyCap: 40,
    screeningMode: 'defer',
    matchThreshold: 45,
    deferHighStakes: true,
    scheduleEnabled: false,
    scheduleEveryMinutes: 1440,
  };
}

// --- Job records --------------------------------------------------------------

export type JobStatus =
  | 'applied'
  | 'queued'
  | 'skipped'
  | 'failed'
  | 'needs_attention';

export interface ScreeningQuestion {
  question: string;
  /** For multiple-choice questions; empty for free-text. */
  options: string[];
  /** The answer chosen/typed (by Claude or the user). */
  answer?: string;
  /** Whether ApplyPilot flagged this as high-stakes/ambiguous. */
  highStakes?: boolean;
}

export interface JobRecord {
  /** Stable id derived from the Indeed job key (jk) or a URL hash. */
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  status: JobStatus;
  /** 0–100 heuristic match score. */
  matchScore: number;
  /** Human-readable reason for the current status. */
  reason: string;
  screeningQuestions: ScreeningQuestion[];
  /** ISO timestamp of the terminal action. */
  appliedAt: string | null;
  /** Id of the run that produced this record. */
  runId: string;
  /** True if the listing advertised Indeed "Easily apply". */
  easilyApply: boolean;
}

// --- Run statistics -----------------------------------------------------------

export interface RunEvent {
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface RunStats {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: 'manual' | 'scheduled';
  counts: {
    scanned: number;
    applied: number;
    queued: number;
    skipped: number;
    failed: number;
    needsAttention: number;
  };
  /** Append-only event log for this run. */
  events: RunEvent[];
}

export function newRunStats(
  runId: string,
  trigger: RunStats['trigger'],
  startedAt: string,
): RunStats {
  return {
    runId,
    startedAt,
    finishedAt: null,
    trigger,
    counts: {
      scanned: 0,
      applied: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
      needsAttention: 0,
    },
    events: [],
  };
}

// --- Runtime status (transient, in chrome.storage.session) -------------------

export type RuntimeState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'blocked' // captcha / logged-out / bot-check detected
  | 'error';

export interface RuntimeStatus {
  state: RuntimeState;
  /** Currently active runId, if any. */
  runId: string | null;
  /** Short message for the popup/dashboard banner. */
  message: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** Progress within the current run. */
  progress: { current: number; max: number };
}

export function idleStatus(): RuntimeStatus {
  return {
    state: 'idle',
    runId: null,
    message: 'Idle',
    updatedAt: new Date().toISOString(),
    progress: { current: 0, max: 0 },
  };
}

// --- Daily counter (for daily cap enforcement) --------------------------------

export interface DailyCounter {
  /** Local date string YYYY-MM-DD. */
  date: string;
  applied: number;
}

// --- Claude response shapes ---------------------------------------------------

export interface ResumeAnalysis {
  score: number;
  feedback: string[];
  skills: string[];
}

export interface ScreeningAnswer {
  answer: string;
  /** Claude's confidence 0–1. */
  confidence: number;
  /** Whether Claude considers this high-stakes/ambiguous. */
  highStakes: boolean;
}
