/**
 * Human-like pacing + daily-cap helpers (anti-ban).
 *
 * The bot must NOT hammer Indeed in a tight loop. Every action is separated by
 * a randomized delay, applications are spread out, and the kill switch is
 * honored between every wait so Stop is responsive.
 */

import {
  ACTION_DELAY_MS,
  APPLICATION_DELAY_MS,
  PAGINATION_DELAY_MS,
} from './config';

/** Random integer in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Promise-based sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep for a randomized duration in the given [min, max] range, but bail early
 * (resolving false) if `shouldAbort` becomes true. Polls every 250ms so Stop is
 * responsive even during a long delay.
 */
export async function jitterWait(
  range: [number, number],
  shouldAbort?: () => Promise<boolean> | boolean,
): Promise<boolean> {
  const total = randInt(range[0], range[1]);
  const step = 250;
  let elapsed = 0;
  while (elapsed < total) {
    if (shouldAbort && (await shouldAbort())) return false;
    await sleep(Math.min(step, total - elapsed));
    elapsed += step;
  }
  return true;
}

export const actionDelay = (abort?: () => Promise<boolean> | boolean) =>
  jitterWait(ACTION_DELAY_MS, abort);

export const applicationDelay = (abort?: () => Promise<boolean> | boolean) =>
  jitterWait(APPLICATION_DELAY_MS, abort);

export const paginationDelay = (abort?: () => Promise<boolean> | boolean) =>
  jitterWait(PAGINATION_DELAY_MS, abort);

/**
 * Type text into an input element character-by-character with small random
 * delays, dispatching input/change events so React-style listeners on Indeed
 * pick up the value. Used by the apply content script.
 */
export async function humanType(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): Promise<void> {
  el.focus();
  el.value = '';
  for (const ch of text) {
    el.value += ch;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(randInt(30, 90));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}
