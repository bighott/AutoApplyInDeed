/**
 * Content script: scrape Indeed search-results pages.
 *
 * Lives on indeed.com pages and answers SCRAPE_SEARCH messages from the
 * background orchestrator. The background is responsible for BUILDING the
 * search URL (from RunConfig) and navigating the tab; this script just reads
 * whatever results page is currently loaded and returns structured listings.
 *
 * It also answers DETECT_SESSION so the orchestrator can check login/bot-check
 * state before doing anything.
 */

import type { ScrapedListing, ScrapeSearchResult } from '../lib/messaging';
import { SELECTORS, queryAll, queryFirst } from './dom-selectors';
import { detectSession } from './session-detect';

function text(el: Element | null): string {
  return (el?.textContent || '').trim().replace(/\s+/g, ' ');
}

/** Extract Indeed's job key (jk) from a title link, for a stable id + URL. */
function extractJobKey(card: Element, link: HTMLAnchorElement | null): string {
  // 1. data-jk on the link or card.
  const jkAttr =
    link?.getAttribute('data-jk') ||
    card.getAttribute('data-jk') ||
    (link?.id?.startsWith('job_') ? link.id.replace('job_', '') : '');
  if (jkAttr) return jkAttr;
  // 2. jk query param in href.
  const href = link?.getAttribute('href') || '';
  const m = href.match(/[?&]jk=([a-z0-9]+)/i);
  if (m) return m[1];
  // 3. Fallback: hash the href/title.
  return `h${hashString(href || text(link))}`;
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function absoluteUrl(href: string, jk: string): string {
  if (!href) return jk ? `https://www.indeed.com/viewjob?jk=${jk}` : '';
  try {
    return new URL(href, location.origin).href;
  } catch {
    return href;
  }
}

function scrapeCurrentPage(): ScrapeSearchResult {
  const session = detectSession();
  if (session.blocked || !session.loggedIn) {
    return {
      ok: false,
      listings: [],
      hasNextPage: false,
      error: session.reason,
    };
  }

  const cards = queryAll<HTMLElement>(document, SELECTORS.SEARCH.card);
  const listings: ScrapedListing[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const titleLink = queryFirst<HTMLAnchorElement>(
      card,
      SELECTORS.SEARCH.title,
    );
    const title = text(titleLink) || text(queryFirst(card, ['h2']));
    if (!title) continue;

    const id = extractJobKey(card, titleLink);
    if (seen.has(id)) continue;
    seen.add(id);

    const easilyApply = !!queryFirst(card, SELECTORS.SEARCH.easilyApply);
    const listing: ScrapedListing = {
      id,
      title,
      company: text(queryFirst(card, SELECTORS.SEARCH.company)),
      location: text(queryFirst(card, SELECTORS.SEARCH.location)),
      url: absoluteUrl(titleLink?.getAttribute('href') || '', id),
      easilyApply,
      snippet: text(queryFirst(card, SELECTORS.SEARCH.snippet)),
    };
    listings.push(listing);
  }

  const hasNextPage = !!queryFirst(document, SELECTORS.SEARCH.nextPage);
  return { ok: true, listings, hasNextPage };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SCRAPE_SEARCH') {
    // Small settle delay lets late-rendered cards mount.
    setTimeout(() => sendResponse(scrapeCurrentPage()), 800);
    return true; // async response
  }
  if (message?.type === 'DETECT_SESSION') {
    sendResponse(detectSession());
    return true;
  }
  return undefined; // not ours; let other listeners handle it
});
