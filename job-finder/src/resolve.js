'use strict';

/**
 * Resolve tracking/redirect URLs (Indeed's especially) to the final employer or
 * ATS application page, so digest "Apply" links go straight to the real form.
 *
 * Strategy: one request following redirects, capture the final URL. HEAD first
 * (cheap); fall back to GET if the server rejects HEAD. Always tolerant — on any
 * failure we return the original URL unchanged.
 */

const DEFAULT_TIMEOUT_MS = 12000;

async function resolveUrl(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return url;

  // Only bother resolving links that look like redirects/trackers.
  if (!looksLikeRedirect(url)) return url;

  for (const method of ['HEAD', 'GET']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (job-finder link resolver)' },
      });
      clearTimeout(timer);
      const final = res.url || url;
      if (final && final !== url) return stripTracking(final);
      // Some servers do JS/meta redirects; if HEAD gave nothing new, try GET.
      if (method === 'GET') return stripTracking(final);
    } catch {
      clearTimeout(timer);
      // try next method, then give up
    }
  }
  return url;
}

function looksLikeRedirect(url) {
  return /(\/rc\/clk|\/pagead\/|indeed\.com\/.*\?|\/viewjob\?|\/rc\/|redirect|track|utm_|jk=|adid=)/i.test(url);
}

/** Drop common tracking query params from a resolved URL. */
function stripTracking(url) {
  try {
    const u = new URL(url);
    const junk = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gh_src', 'gclid', 'fbclid', 'source', 'ref', '_ga',
    ];
    junk.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Resolve many jobs' apply links with bounded concurrency. Mutates each job's
 * apply_url in place. Only touches Indeed jobs by default (others already have
 * direct links), but pass `all: true` to resolve everything.
 */
async function resolveJobs(jobs, { concurrency = 6, all = false } = {}) {
  const targets = jobs.filter((j) => all || j.source === 'indeed');
  let i = 0;
  async function worker() {
    while (i < targets.length) {
      const job = targets[i++];
      const original = job.apply_url || job.url;
      const resolved = await resolveUrl(original);
      job.apply_url = resolved || original;
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, worker);
  await Promise.all(workers);
  return jobs;
}

module.exports = { resolveUrl, resolveJobs, stripTracking };
