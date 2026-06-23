/**
 * ============================================================================
 * CENTRALIZED INDEED DOM SELECTORS
 * ============================================================================
 * Last verified against Indeed.com layout: 2025-06 (US desktop).
 *
 * Indeed changes its markup FREQUENTLY and runs A/B tests, so selectors here
 * are arrays of fallbacks tried in order. When the bot breaks after an Indeed
 * redesign, THIS IS THE ONLY FILE YOU SHOULD NEED TO EDIT.
 *
 * Maintenance tips:
 *  - Prefer stable hooks: data-testid, id, aria-label, name attributes.
 *  - Keep the most-current selector first, older fallbacks after.
 *  - Class names with hashes (e.g. css-1abc2de) are volatile — avoid relying
 *    on them alone; pair with a structural/text fallback.
 *
 * Likely-to-change hotspots (flagged for maintenance):
 *  - SEARCH.card / SEARCH.title           (results card markup)
 *  - APPLY.continueButton / APPLY.submit  (the Smart Apply modal flow)
 *  - APPLY.modalRoot                      (Apply iframe/host container)
 *  - SESSION.botCheck                     (captcha / "verify you are human")
 * ============================================================================
 */

export const SELECTORS = {
  // --- Session / auth state -------------------------------------------------
  SESSION: {
    // Elements that indicate a logged-in account (avatar / account menu).
    loggedIn: [
      '[data-gnav-element-name="AccountMenu"]',
      '#gnav-main-1 [data-gnav-element-name="AccountMenu"]',
      'a[href*="/account"]',
      '[aria-label="Account"]',
    ],
    // Elements that indicate logged-out (Sign in links).
    loggedOut: [
      'a[href*="/account/login"]',
      'a[data-gnav-element-name="SignIn"]',
      '#gnav-main-1 a[href*="login"]',
    ],
    // Bot-check / captcha / interstitial markers.
    botCheck: [
      '#cf-challenge-running', // Cloudflare
      'iframe[src*="recaptcha"]',
      'iframe[title*="challenge"]',
      'form[action*="captcha"]',
      'h1, h2', // text-matched separately for "verify you are human"
    ],
  },

  // --- Search results page --------------------------------------------------
  SEARCH: {
    // Each job result card.
    card: [
      '#mosaic-provider-jobcards li div.cardOutline',
      '#mosaic-provider-jobcards .job_seen_beacon',
      '.jobsearch-ResultsList > li',
      'div.job_seen_beacon',
      'a.tapItem',
    ],
    // Job title link inside a card (also gives us the URL + jobkey).
    title: [
      'h2.jobTitle a',
      'a.jcs-JobTitle',
      'h2 a[data-jk]',
      'a[id^="job_"]',
    ],
    company: ['[data-testid="company-name"]', '.companyName', 'span.companyName'],
    location: [
      '[data-testid="text-location"]',
      '.companyLocation',
      'div.companyLocation',
    ],
    // "Easily apply" badge inside a card.
    easilyApply: [
      '[data-testid="indeedApply"]',
      'span.ialbl', // "Easily apply" label
      'span:is(.iaLabel, .indeedApply)',
    ],
    // Short snippet/description text on the card.
    snippet: [
      '[data-testid="jobsnippet_footer"]',
      '.job-snippet',
      'div.job-snippet',
      'ul[style*="list-style-type"]',
    ],
    // Pagination "Next" link.
    nextPage: [
      'a[data-testid="pagination-page-next"]',
      'a[aria-label="Next Page"]',
      'a[aria-label="Next"]',
      'nav[role="navigation"] a[aria-label*="Next"]',
    ],
  },

  // --- Easily-Apply / Smart Apply modal ------------------------------------
  APPLY: {
    // The "Apply now" launch button on a job detail / card.
    applyButton: [
      '#indeedApplyButton',
      '[data-testid="indeedApplyButton"]',
      'button[aria-label*="Apply now"]',
      '.indeed-apply-button',
      'button.ia-IndeedApplyButton',
    ],
    // The Smart Apply flow renders inside an iframe in some variants.
    modalIframe: [
      'iframe[title*="Apply"]',
      'iframe[src*="smartapply"]',
      'iframe#indeedapply-modal-iframe',
    ],
    // Root container of the in-page apply modal (non-iframe variant).
    modalRoot: [
      '.ia-Modal',
      '[data-testid="ia-Modal"]',
      'div[role="dialog"]',
    ],
    // "Continue" / next-step button in the multi-page flow.
    continueButton: [
      'button[data-testid="continue-button"]',
      'button[data-testid="IndeedApplyButton"]',
      'button.ia-continueButton',
      'button[type="submit"]',
    ],
    // Final "Submit application" button.
    submitButton: [
      'button[data-testid="submit-application"]',
      'button[data-testid="indeed-apply-submit-button"]',
      'button[aria-label*="Submit"]',
    ],
    // Confirmation screen after a successful submit.
    successMarker: [
      '[data-testid="post-apply-page"]',
      'h1:is(.ia-PostApply-headline)',
      '[data-testid="application-submitted"]',
    ],
    // Generic field hooks for the contact step.
    nameInput: ['input[name="name"]', 'input#input-applicant\\.name'],
    firstNameInput: ['input[name="firstName"]', 'input#input-firstName'],
    lastNameInput: ['input[name="lastName"]', 'input#input-lastName'],
    emailInput: ['input[type="email"]', 'input[name="email"]'],
    phoneInput: ['input[type="tel"]', 'input[name="phoneNumber"]', 'input[name="phone"]'],
    locationInput: ['input[name="location"]', 'input[name="city"]'],
    // Resume upload control + "use saved resume" option.
    resumeFileInput: ['input[type="file"]'],
    useSavedResume: [
      '[data-testid="resume-display-buttonHeader"]',
      'button[aria-label*="saved resume"]',
    ],
    // A screening-question block (question + its inputs).
    questionBlock: [
      '[data-testid^="questions-"]',
      'fieldset',
      'div.ia-Questions-item',
    ],
    questionLabel: ['legend', 'label', '.ia-Questions-item-label'],
    radioOption: ['input[type="radio"]'],
    checkboxOption: ['input[type="checkbox"]'],
    selectInput: ['select'],
    textInput: [
      'input[type="text"]',
      'input[type="number"]',
      'textarea',
      'input:not([type])',
    ],
  },
} as const;

/** Query the first element matching any selector in the list. */
export function queryFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector<T>(sel);
      if (el) return el;
    } catch {
      // Invalid/unsupported selector in this browser — skip it.
    }
  }
  return null;
}

/** Query all elements matching the FIRST selector that yields any matches. */
export function queryAll<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T[] {
  for (const sel of selectors) {
    try {
      const els = root.querySelectorAll<T>(sel);
      if (els.length) return Array.from(els);
    } catch {
      // skip invalid selector
    }
  }
  return [];
}

/** Wait until a matching element appears (or timeout). Returns it or null. */
export function waitForFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
  timeoutMs = 10000,
): Promise<T | null> {
  return new Promise((resolve) => {
    const existing = queryFirst<T>(root, selectors);
    if (existing) return resolve(existing);

    const start = Date.now();
    const interval = setInterval(() => {
      const el = queryFirst<T>(root, selectors);
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 200);
  });
}
