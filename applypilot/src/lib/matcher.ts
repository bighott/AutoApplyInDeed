/**
 * Local heuristic matcher.
 *
 * Scores a scraped listing (0–100) against the run config + accepted skills.
 * This is intentionally LOCAL/heuristic — no Claude calls here. Claude is only
 * used later for the deeper screening-question answering, to avoid burning
 * tokens on every listing.
 */

import type { ScrapedListing } from './messaging';
import type { RunConfig, UserProfile, WorkMode } from './types';

export interface MatchResult {
  score: number; // 0–100
  passed: boolean;
  reason: string;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function haystack(listing: ScrapedListing): string {
  return `${listing.title} ${listing.company} ${listing.location} ${listing.snippet}`.toLowerCase();
}

function workModeMatches(listing: ScrapedListing, mode: WorkMode): boolean {
  if (mode === 'any') return true;
  const h = haystack(listing);
  const isRemote = /\bremote\b/.test(h) || /work from home/.test(h);
  const isHybrid = /\bhybrid\b/.test(h);
  if (mode === 'remote') return isRemote;
  if (mode === 'hybrid') return isHybrid || isRemote;
  // 'local' = on-site/local; treat explicitly-remote-only as a mismatch.
  if (mode === 'local') return !isRemote || isHybrid;
  return true;
}

/** Try to read a salary figure out of the snippet ("$120,000", "$60/hr"). */
function extractSalary(listing: ScrapedListing): number | null {
  const m = listing.snippet.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|\/hr|\/hour)?/i);
  if (!m) return null;
  let val = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') val *= 1000;
  if (unit === '/hr' || unit === '/hour') val *= 2080; // annualize
  return val;
}

export function scoreListing(
  listing: ScrapedListing,
  config: RunConfig,
  profile: UserProfile,
): MatchResult {
  const h = haystack(listing);

  // Hard exclusions first.
  for (const ex of config.excludeKeywords) {
    const e = ex.trim().toLowerCase();
    if (e && h.includes(e)) {
      return { score: 0, passed: false, reason: `Excluded by keyword "${ex}"` };
    }
  }

  // Work-mode filter.
  if (!workModeMatches(listing, config.workMode)) {
    return {
      score: 0,
      passed: false,
      reason: `Work mode mismatch (wanted ${config.workMode})`,
    };
  }

  // Salary floor (only when we could read one; missing salary doesn't fail).
  if (config.salaryMin > 0) {
    const sal = extractSalary(listing);
    if (sal !== null && sal < config.salaryMin) {
      return {
        score: 0,
        passed: false,
        reason: `Salary $${Math.round(sal)} below floor $${config.salaryMin}`,
      };
    }
  }

  // --- Weighted scoring ---
  let score = 0;
  const titleTokens = new Set(tokenize(listing.title));

  // Keyword overlap (max 50). Title hits weigh double.
  const keywords = config.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (keywords.length) {
    let kwHits = 0;
    for (const kw of keywords) {
      const inHay = h.includes(kw);
      const inTitle = kw.split(/\s+/).some((t) => titleTokens.has(t));
      if (inTitle) kwHits += 2;
      else if (inHay) kwHits += 1;
    }
    score += Math.min(50, (kwHits / (keywords.length * 2)) * 50);
  } else {
    score += 25; // no keywords specified -> neutral baseline
  }

  // Skill overlap (max 40).
  const skills = profile.skills.map((s) => s.toLowerCase()).filter(Boolean);
  if (skills.length) {
    let skillHits = 0;
    for (const sk of skills) if (h.includes(sk)) skillHits++;
    score += Math.min(40, (skillHits / Math.min(skills.length, 10)) * 40);
  }

  // Easily-apply bonus (max 10) — these are the only auto-submittable ones.
  if (listing.easilyApply) score += 10;

  score = Math.round(Math.max(0, Math.min(100, score)));
  const passed = score >= config.matchThreshold;
  return {
    score,
    passed,
    reason: passed
      ? `Match score ${score} ≥ threshold ${config.matchThreshold}`
      : `Match score ${score} < threshold ${config.matchThreshold}`,
  };
}
