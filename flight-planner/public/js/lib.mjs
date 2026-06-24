// Pure, framework-free helpers shared by the UI (app.mjs) and the Node tests
// (lib.test.mjs). Nothing in here touches the DOM, the network, or globals, so
// it can be imported in the browser as a module and exercised under node:test.

export const money = (n, c) => (n == null ? '—' : `${c} ${Number(n).toFixed(2)}`);
export const fmtMins = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${MON[+m[2] - 1]} ${+m[3]}` : String(d || '');
}
export function rawTime(t) {
  const m = String(t == null ? '' : t).match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : '';
}

// ---- baggage estimate (per-airline first-checked-bag fee, USD) --------------
export const BAG_FEES = {
  WN: 0, B6: 35, AS: 35, AA: 40, DL: 35, UA: 40, NK: 45, F9: 45, HA: 35, AC: 35, WS: 35,
  BA: 0, VS: 0, AF: 0, KL: 0, LH: 0, LX: 0, IB: 0, EI: 0, TP: 0, AY: 0, SK: 0, OS: 0, SN: 0,
  EK: 0, QR: 0, EY: 0, SV: 0, SQ: 0, CX: 0, NH: 0, JL: 0, KE: 0, QF: 0, TK: 0, FI: 30, AZ: 0,
};
export const DEFAULT_BAG_FEE = 40;
export function bagFee(code) {
  return code && Object.prototype.hasOwnProperty.call(BAG_FEES, code) ? BAG_FEES[code] : DEFAULT_BAG_FEE;
}
export function bagEstimate(it, bags) {
  if (!bags || bags <= 0) return 0;
  return bags * it.legs.reduce((s, l) => s + (l.quote ? bagFee(l.quote.airlineCode) : DEFAULT_BAG_FEE), 0);
}
export function bagLine(it, bags, cur) {
  if (!bags || bags <= 0) return '';
  const b = bagEstimate(it, bags);
  return `<div class="trip-bag">+ <b>${money(b, cur)}</b> bags (est., ${bags}×) · with bags <b>${money(it.total + b, cur)}</b></div>`;
}

// ---- data-confidence badge --------------------------------------------------
export const CONF_META = {
  live: { lab: 'Live prices', cls: 'conf-live', tip: 'Real-time fares from a carrier/aggregator query.' },
  cached: { lab: 'Cached prices', cls: 'conf-cached', tip: 'Recent aggregated fares that may lag the live market.' },
  estimate: { lab: 'Estimated', cls: 'conf-est', tip: 'Static/demo fares — directional only, not bookable quotes.' },
  mixed: { lab: 'Mixed sources', cls: 'conf-mixed', tip: 'Different legs were priced by different sources.' },
};
export function confBadgeHtml(conf) {
  if (!conf) return '';
  const m = CONF_META[conf.tier] || CONF_META.estimate;
  const used = (conf.sources || [])
    .filter((s) => s)
    .map((s) => {
      const t = CONF_META[s.tier] || CONF_META.estimate;
      return `${s.name}${s.legs ? ` <span class="meta">(${s.legs} leg${s.legs === 1 ? '' : 's'})</span>` : ''} <span class="conf-dot ${t.cls}"></span>`;
    })
    .join(' · ');
  return `<div class="confbar"><span class="conf-badge ${m.cls}" title="${m.tip}">${m.lab}</span>${used ? `<span class="meta">${used}</span>` : ''}</div>`;
}

// ---- CSV --------------------------------------------------------------------
export function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function pathLabel(it) {
  return [...it.legs.map((l) => l.origin), it.legs[it.legs.length - 1].destination].join(' → ');
}
export function legsToCsvRows(itins, routeLabelFn) {
  const header = ['Option', 'Route', 'From', 'To', 'Date', 'Depart', 'Arrive', 'Airline', 'Flight', 'Stops', 'Duration', 'Price', 'Currency', 'Book'];
  const rows = [header];
  itins.forEach((it, i) => {
    it.legs.forEach((l) => {
      const q = l.quote || {};
      rows.push([i + 1, routeLabelFn(it), l.origin, l.destination, l.date, rawTime(q.departTime), rawTime(q.arriveTime),
        q.airline || '', q.flightNumber || '', q.stops == null ? '' : q.stops, q.durationLabel || '', q.price == null ? '' : q.price, q.currency || '', q.bookingUrl || '']);
    });
  });
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
