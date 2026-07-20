'use strict';

const crypto = require('crypto');

/** Return the first defined, non-empty value among the given keys. */
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function asText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    // Common shapes: {min,max,currency} or {display} or {text}
    const disp = pick(v, ['display', 'text', 'formatted', 'label']);
    if (disp) return asText(disp);
    if (v.min || v.max) {
      const cur = v.currency || v.currencyCode || '';
      return [v.min, v.max].filter(Boolean).join('–') + (cur ? ` ${cur}` : '');
    }
  }
  return null;
}

/** sha1(lowercase(title)+company+location) — the dedupe identity of a job. */
function dedupeKey(title, company, location) {
  const norm = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
  const raw = `${norm(title)}|${norm(company)}|${norm(location)}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/**
 * Turn a raw Apify dataset item into our common job shape. `source` is one of
 * linkedin | indeed | ats. `opts.under10Default` marks the low-applicant flag
 * when the actor filtered for it and returns no explicit applicant count.
 */
function normalizeItem(source, item, opts = {}) {
  const title = asText(pick(item, ['title', 'jobTitle', 'position', 'name', 'positionName']));
  const company = asText(
    pick(item, ['company', 'companyName', 'employer', 'organization', 'company_name', 'organization_name', 'hiringOrganization'])
  );
  const location = asText(
    pick(item, ['location', 'jobLocation', 'place', 'city', 'formattedLocation', 'locationName', 'locations', 'location_name'])
  );

  if (!title || !company) return null; // unusable record

  const url = asText(
    pick(item, ['url', 'jobUrl', 'link', 'jobPostingUrl', 'postingUrl', 'detailsUrl', 'jobLink'])
  );
  const applyUrl = asText(
    pick(item, ['applyUrl', 'applicationUrl', 'apply_link', 'applyLink', 'redirectUrl', 'externalApplyLink', 'url_apply'])
  );
  const salary = asText(
    pick(item, ['salary', 'salaryText', 'compensation', 'salary_range', 'salaryRange', 'formattedSalary', 'pay', 'salary_raw'])
  );
  const postedAt = asText(
    pick(item, ['postedAt', 'publishedAt', 'datePosted', 'postedDate', 'date', 'listedAt', 'date_posted', 'posted'])
  );
  const description = asText(
    pick(item, ['description', 'descriptionText', 'jobDescription', 'jobDescriptionText', 'snippet', 'summary', 'text'])
  );

  // Applicant count (LinkedIn low-competition detection)
  const applicantsRaw = pick(item, ['applicantsCount', 'numApplicants', 'applicants', 'applicant_count']);
  const applicants = applicantsRaw != null ? parseInt(String(applicantsRaw).replace(/[^\d]/g, ''), 10) : null;
  let under10;
  if (Number.isFinite(applicants)) under10 = applicants < 10;
  else under10 = !!opts.under10Default;

  const id = dedupeKey(title, company, location);

  return {
    id,
    source,
    title,
    company,
    location,
    salary,
    posted_at: postedAt,
    url: url || applyUrl || null,
    apply_url: applyUrl || url || null,
    description: description ? description.slice(0, 8000) : null,
    under10: under10 ? 1 : 0,
    raw: item,
  };
}

module.exports = { normalizeItem, dedupeKey, pick, asText };
