/**
 * Typed message protocol between UI <-> background <-> content scripts.
 *
 * All chrome.runtime / chrome.tabs messages use the discriminated union below
 * so every sender/receiver shares one contract.
 */

import type { JobRecord, RunConfig, ScreeningQuestion } from './types';

// UI / popup -> background
export type CommandMessage =
  | { type: 'RUN_NOW' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'RESUME' }
  | { type: 'GET_STATUS' }
  | { type: 'SYNC_SCHEDULE' };

// background -> content (search script)
export interface ScrapeSearchMessage {
  type: 'SCRAPE_SEARCH';
  config: RunConfig;
  /** 0-based page index for pagination. */
  page: number;
}

export interface ScrapedListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  easilyApply: boolean;
  /** Snippet/description text scraped from the card, used by the matcher. */
  snippet: string;
}

export interface ScrapeSearchResult {
  ok: boolean;
  listings: ScrapedListing[];
  /** True if another results page is available. */
  hasNextPage: boolean;
  error?: string;
}

// background -> content (apply script)
export interface ApplyJobMessage {
  type: 'APPLY_JOB';
  job: JobRecord;
  config: RunConfig;
  // Flattened profile fields the apply content script needs to fill the form.
  profileName: string;
  profileEmail: string;
  profilePhone: string;
  profileLocation: string;
  resumeDataUrl?: string;
  resumeFileName?: string;
  resumeMimeType?: string;
}

export type ApplyOutcome =
  | { status: 'applied'; reason: string }
  | { status: 'needs_attention'; reason: string; questions: ScreeningQuestion[] }
  | { status: 'failed'; reason: string }
  | { status: 'blocked'; reason: string };

export interface ApplyJobResult {
  ok: boolean;
  outcome: ApplyOutcome;
}

// content (apply) -> background: request a Claude answer for a screening question
export interface AnswerQuestionMessage {
  type: 'ANSWER_QUESTION';
  question: ScreeningQuestion;
}

export interface AnswerQuestionResult {
  ok: boolean;
  answer?: string;
  confidence?: number;
  highStakes?: boolean;
  error?: string;
}

// any context -> background: session/bot-check status report
export interface SessionStateMessage {
  type: 'SESSION_STATE';
  loggedIn: boolean;
  blocked: boolean;
  reason: string;
}

export type ContentMessage =
  | ScrapeSearchMessage
  | ApplyJobMessage
  | { type: 'DETECT_SESSION' };

export type BackgroundMessage =
  | AnswerQuestionMessage
  | SessionStateMessage;

export type AnyMessage = CommandMessage | ContentMessage | BackgroundMessage;
