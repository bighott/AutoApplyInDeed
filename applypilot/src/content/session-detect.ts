/**
 * Indeed session / bot-check detection.
 *
 * We NEVER store Indeed credentials. We only read the existing page to decide:
 *   - is the user logged in?
 *   - is Indeed showing a captcha / bot-check / interstitial?
 *
 * When blocked, the orchestrator pauses the whole run and shows a banner
 * rather than trying to push through (which is how accounts get flagged).
 */

import { SELECTORS, queryAll, queryFirst } from './dom-selectors';

export interface SessionState {
  loggedIn: boolean;
  blocked: boolean;
  reason: string;
}

const BOT_CHECK_TEXT =
  /(verify you are (a )?human|are you a robot|unusual traffic|complete the security check|additional verification)/i;

export function detectSession(): SessionState {
  // 1. Bot-check / captcha detection (highest priority).
  for (const sel of SELECTORS.SESSION.botCheck) {
    if (sel === 'h1, h2') continue; // handled via text below
    if (queryFirst(document, [sel])) {
      return {
        loggedIn: false,
        blocked: true,
        reason: 'Indeed is showing a security/bot check.',
      };
    }
  }
  // Text-based bot-check (Indeed often uses a plain heading).
  const headings = queryAll<HTMLElement>(document, ['h1', 'h2']);
  for (const h of headings) {
    if (BOT_CHECK_TEXT.test(h.textContent || '')) {
      return {
        loggedIn: false,
        blocked: true,
        reason: 'Indeed is showing a verification challenge.',
      };
    }
  }

  // 2. Logged-in detection.
  const loggedInEl = queryFirst(document, SELECTORS.SESSION.loggedIn);
  if (loggedInEl) {
    return { loggedIn: true, blocked: false, reason: 'Signed in to Indeed.' };
  }

  // 3. Logged-out detection.
  const loggedOutEl = queryFirst(document, SELECTORS.SESSION.loggedOut);
  if (loggedOutEl) {
    return {
      loggedIn: false,
      blocked: false,
      reason: 'Not signed in to Indeed. Please sign in and retry.',
    };
  }

  // 4. Ambiguous — assume not-logged-in to be safe (don't push through).
  return {
    loggedIn: false,
    blocked: false,
    reason: 'Could not confirm Indeed sign-in state.',
  };
}
