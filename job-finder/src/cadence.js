'use strict';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Should an actor run today given its cadence config?
 *   cadence: "daily"            → every day
 *   cadence: "weekdays"         → Mon–Fri
 *   cadence: ["mon", "thu"]     → those weekdays only
 * `date` defaults to now; pass one for testing.
 */
function shouldRunToday(cadence, date = new Date()) {
  const dow = DAYS[date.getDay()];
  if (!cadence) return true;
  if (typeof cadence === 'string') {
    const c = cadence.toLowerCase();
    if (c === 'daily' || c === 'always') return true;
    if (c === 'weekdays') return !['sat', 'sun'].includes(dow);
    if (c === 'weekly') return dow === 'mon';
    return c === dow;
  }
  if (Array.isArray(cadence)) {
    return cadence.map((d) => String(d).toLowerCase().slice(0, 3)).includes(dow);
  }
  return true;
}

module.exports = { shouldRunToday, DAYS };
