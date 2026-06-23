/**
 * Central configuration constants for ApplyPilot.
 *
 * The Claude model name lives here and ONLY here — change it in one place to
 * upgrade/downgrade the model used for resume scoring and screening answers.
 */

// --- Claude API ---------------------------------------------------------------

/** Default Claude model. Read from this single constant everywhere. */
export const CLAUDE_MODEL = 'claude-opus-4-8';

/** Anthropic Messages API endpoint. */
export const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/** Anthropic API version header value. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** Max tokens for Claude responses (resume scoring / Q&A are small). */
export const CLAUDE_MAX_TOKENS = 4096;

// --- Matching -----------------------------------------------------------------

/** Listings below this match score (0–100) are skipped. Configurable in UI. */
export const DEFAULT_MATCH_THRESHOLD = 45;

// --- Throttling (human-like pacing, anti-ban) ---------------------------------

/** Min/max delay (ms) between small DOM actions (typing, clicking). */
export const ACTION_DELAY_MS: [number, number] = [600, 1800];

/** Min/max delay (ms) between processing two separate listings/applications. */
export const APPLICATION_DELAY_MS: [number, number] = [8000, 22000];

/** Min/max delay (ms) between paginated search-result page loads. */
export const PAGINATION_DELAY_MS: [number, number] = [3000, 7000];

// --- Run limits ---------------------------------------------------------------

export const DEFAULT_MAX_PER_RUN = 15;
export const DEFAULT_DAILY_CAP = 40;

// --- Alarms -------------------------------------------------------------------

/** Name of the chrome.alarms alarm used for scheduled runs. */
export const SCHEDULE_ALARM_NAME = 'applypilot-scheduled-run';

// --- Storage keys (kept here so storage.ts and others stay in sync) ----------

export const STORAGE_KEYS = {
  profile: 'profile',
  runConfig: 'runConfig',
  jobs: 'jobs',
  runs: 'runs',
  apiKey: 'anthropicApiKey',
  killSwitch: 'killSwitch',
  runtimeStatus: 'runtimeStatus',
  dailyCounter: 'dailyCounter',
} as const;
