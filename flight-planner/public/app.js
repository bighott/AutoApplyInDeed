const $ = (id) => document.getElementById(id);
const money = (n,c) => n==null ? '—' : `${c} ${Number(n).toFixed(2)}`;
const fmtMins = (m) => m==null ? '—' : `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- theme (light/dark) -----------------------------------------------------
function applyTheme(t){
  document.documentElement.dataset.theme=t;
  try { localStorage.setItem('pmf_theme', t); } catch {}
  const b=$('themeBtn');
  if(b){ b.textContent = t==='dark'?'☀':'☾'; b.setAttribute('aria-label', t==='dark'?'Switch to light mode':'Switch to dark mode'); }
}
applyTheme((()=>{ try { return localStorage.getItem('pmf_theme')||'light'; } catch { return 'light'; } })());
$('themeBtn').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');

// ---- autocomplete -----------------------------------------------------------
async function fetchAirports(q){ try { const r=await fetch(`/api/airports?q=${encodeURIComponent(q)}&limit=8`); return r.ok?r.json():[]; } catch { return []; } }
function attachAutocomplete(input, onSelect){
  const menu = input.closest('.combo').querySelector('.ac-menu');
  let items=[], active=-1, timer=null;
  const close=()=>{ menu.style.display='none'; menu.innerHTML=''; active=-1; };
  const choose=(a)=>{ input.value=a.iata; if(onSelect) onSelect(a); close(); input.dispatchEvent(new Event('change')); };
  const draw=()=>{
    if(!items.length){ close(); return; }
    menu.innerHTML = items.map((a,i)=>`<div class="ac-item${i===active?' on':''}" data-i="${i}"><b>${a.iata}</b>
      <span>${escapeHtml(a.city)}</span><small>${escapeHtml(a.name)} · ${escapeHtml(a.country)}</small></div>`).join('');
    menu.style.display='block';
    [...menu.children].forEach(el=>{ el.onmousedown=(e)=>{ e.preventDefault(); choose(items[+el.dataset.i]); }; });
  };
  input.addEventListener('input',()=>{ const q=input.value.trim(); clearTimeout(timer);
    if(!q){ close(); return; } timer=setTimeout(async()=>{ items=await fetchAirports(q); active=-1; draw(); },110); });
  input.addEventListener('keydown',(e)=>{ if(menu.style.display!=='block') return;
    if(e.key==='ArrowDown'){ e.preventDefault(); active=Math.min(active+1,items.length-1); draw(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); active=Math.max(active-1,0); draw(); }
    else if(e.key==='Enter'&&active>=0){ e.preventDefault(); choose(items[active]); }
    else if(e.key==='Escape'){ close(); } });
  input.addEventListener('blur',()=>setTimeout(close,150));
}

// ---- origins ----------------------------------------------------------------
function addOrigin(code=''){
  const el=document.createElement('div'); el.className='origin-row';
  el.innerHTML=`<div class="combo"><input class="o-code" aria-label="Origin airport code" value="${code}" placeholder="Type a city or airport code…" autocomplete="off" /><div class="ac-menu"></div></div>
    <button type="button" class="xbtn" title="Remove origin" aria-label="Remove origin">✕</button>`;
  el.querySelector('.xbtn').onclick=()=>{ if(document.querySelectorAll('#origins .origin-row').length>1) el.remove(); };
  $('origins').appendChild(el); attachAutocomplete(el.querySelector('.o-code'));
}
$('addOrigin').onclick=()=>addOrigin();

// ---- stops (auto-fill label with city) --------------------------------------
function addStop(code='',label='',min=2,max=3){
  const el=document.createElement('div'); el.className='stop';
  el.innerHTML=`
    <button type="button" class="xbtn" title="Remove stop" aria-label="Remove stop">✕</button>
    <div class="field" style="margin-bottom:8px"><label>Stop airport</label>
      <div class="combo"><input class="s-code" aria-label="Stop airport code" value="${code}" placeholder="City or code…" autocomplete="off" /><div class="ac-menu"></div></div></div>
    <div class="row">
      <div class="field" style="margin-bottom:8px"><label>Label (auto-fills with city)</label><input class="s-label" aria-label="Stop label" value="${label}" /></div>
      <div class="field" style="margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label>Min nights</label><input class="s-min" aria-label="Minimum nights" type="number" min="0" value="${min}" /></div>
        <div><label>Max nights</label><input class="s-max" aria-label="Maximum nights" type="number" min="0" value="${max}" /></div></div></div>`;
  el.querySelector('.xbtn').onclick=()=>{ if(document.querySelectorAll('#stops .stop').length>1) el.remove(); };
  $('stops').appendChild(el);
  const lab=el.querySelector('.s-label');
  // Always set the label to the selected airport's city, overwriting whatever
  // was there — the label should track the chosen stop airport.
  attachAutocomplete(el.querySelector('.s-code'),(a)=>{ lab.value=a.city; });
}
$('addStop').onclick=()=>addStop();

// seed defaults
addOrigin('SFO');
addStop('JFK','New York',2,3);
addStop('LHR','London',3,4);

// ---- provider hint + key warning -------------------------------------------
const HINTS={ mock:'Demo prices. Works for any route instantly — great for trying the app, no key or cost.',
  serpapi:'Real fares via Google Flights (uses your SERPAPI_KEY). One billed search per unique leg/date.',
  travelpayouts:'Free, real (cached) prices from Travelpayouts/Aviasales. Needs a free TRAVELPAYOUTS_TOKEN. No per-search cost.',
  amadeus:'Real bookable fares from Amadeus (free tier). Needs AMADEUS_CLIENT_ID & SECRET. Counts toward the search budget.',
  expedia:'Free Expedia fare snapshot — no key, no cost, but only covers the seeded SFO/JFK/LHR July-2026 legs.',
  crosscheck:'Google Flights (live) vs the Expedia snapshot, picks the cheaper per leg.' };
// Which .env credential each source needs (mock/expedia need none).
const NEEDS_CRED={ serpapi:'SERPAPI_KEY', crosscheck:'SERPAPI_KEY', travelpayouts:'TRAVELPAYOUTS_TOKEN', amadeus:'AMADEUS_CLIENT_ID & AMADEUS_CLIENT_SECRET' };
let CRED={ serpapi:false, travelpayouts:false, amadeus:false };
function providerReady(v){
  if(v==='mock'||v==='expedia') return true;
  if(v==='crosscheck') return CRED.serpapi;
  return !!CRED[v];
}
function credWarn(v, slotId){
  const ready=providerReady(v), need=NEEDS_CRED[v];
  $(slotId).innerHTML=(ready||!need)?'':`<div class="banner warn">This source needs <b>${need}</b> in <code>flight-planner/.env</code>. Use <b>Demo</b> or <b>Expedia</b> meanwhile.</div>`;
}
function updateHint(){ $('providerHint').textContent=HINTS[$('provider').value]; credWarn($('provider').value,'keyWarn'); }
$('provider').onchange=updateHint;
fetch('/api/config').then(r=>r.json()).then(c=>{ if(c.providers) CRED=c.providers; updateHint(); aUpdateHint(); }).catch(()=>{});
updateHint();

// ---- submit -----------------------------------------------------------------
function val(id){ const el=$(id); if(!el) throw new Error(`UI out of date (missing #${id}). Hard-refresh the page (Ctrl+F5).`); return el.value; }
function qsv(el,sel){ const n=el.querySelector(sel); return n?n.value:''; }
function readSpec(){
  const origins=[...document.querySelectorAll('.o-code')].map(i=>i.value.trim().toUpperCase()).filter(Boolean);
  if(!origins.length) throw new Error('Add at least one origin airport.');
  const stops=[...document.querySelectorAll('#stops .stop')].map(el=>({
    code: qsv(el,'.s-code').trim().toUpperCase(),
    label: qsv(el,'.s-label').trim()||undefined,
    minNights:Number(qsv(el,'.s-min')), maxNights:Number(qsv(el,'.s-max')),
  }));
  return { origin:origins[0], origins, stops, returnToOrigin:$('returnToOrigin').checked,
    startDate:val('startDate'), startFlexDays:Number(val('startFlexDays')),
    adults:Number(val('adults')), cabin:val('cabin'), currency:val('currency').trim().toUpperCase()||'USD' };
}
$('form').onsubmit=async(e)=>{
  e.preventDefault(); const btn=$('run'); btn.disabled=true; btn.textContent='Searching…';
  show(`<div class="empty"><span class="spinner"></span> Pricing legs…</div>`);
  try {
    const res=await fetch('/api/plan',{ method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ spec:readSpec(), provider:$('provider').value }) });
    const data=await res.json();
    if(!data.ok) throw new Error(data.error||'Request failed');
    STATE=data; STATE.sort='price'; render();
  } catch(err){ show(`<div class="error"><b>Error:</b> ${escapeHtml(err.message)}</div>`); }
  finally { btn.disabled=false; btn.textContent='Search flights'; }
};

// ---- rendering --------------------------------------------------------------
let STATE=null;
function show(html){ $('results').innerHTML=`<div class="results-head"><h2>Results</h2></div>${html}`; }
const itinKey=(it)=>it?`${it.origin}>${it.returnOrigin||''}|${it.startDate}|${it.nightsPerStop.join(',')}`:'';
const cityOf=(c)=>(STATE.cityByCode&&STATE.cityByCode[c])||c;

function joinSeq(arr){ if(arr.length<=1) return arr[0]||''; return arr.slice(0,-1).join(', then ')+', then '+arr[arr.length-1]; }
function explain(it){
  const stops=STATE.spec.stops;
  const total=it.nightsPerStop.reduce((a,b)=>a+b,0);
  const segs=stops.map((st,i)=>{ const city=st.label||cityOf(st.code); const n=it.nightsPerStop[i]; return `${n} night${n===1?'':'s'} in ${city}`; });
  let s=`Leave ${cityOf(it.origin)} on ${it.startDate}. You'll spend ${joinSeq(segs)}.`;
  if(it.returnOrigin){ s+= it.returnOrigin===it.origin
      ? ` Then fly home to ${cityOf(it.returnOrigin)}.`
      : ` Then fly home into ${cityOf(it.returnOrigin)} — a different city than you left from.`; }
  s+=` In total: ${total} night${total===1?'':'s'} away · ${fmtMins(it.totalDurationMinutes)} in the air.`;
  return s;
}

// --- airline logos -----------------------------------------------------------
const AIRLINE_IATA = {
  'American':'AA','American Airlines':'AA','Delta':'DL','Delta Air Lines':'DL','United':'UA','United Airlines':'UA',
  'Southwest':'WN','Southwest Airlines':'WN','JetBlue':'B6','Alaska':'AS','Alaska Airlines':'AS','Spirit':'NK',
  'Frontier':'F9','Hawaiian':'HA','Hawaiian Airlines':'HA',
  'British Airways':'BA','Virgin Atlantic':'VS','Air France':'AF','KLM':'KL','Lufthansa':'LH','Swiss':'LX',
  'Austrian':'OS','Brussels Airlines':'SN','Iberia':'IB','TAP':'TP','TAP Portugal':'TP','TAP Air Portugal':'TP',
  'Ryanair':'FR','easyJet':'U2','Vueling':'VY','Norwegian':'DY','SAS':'SK','Finnair':'AY','Aer Lingus':'EI',
  'ITA Airways':'AZ','Alitalia':'AZ','Turkish Airlines':'TK','Turkish':'TK','Aegean':'A3','LOT':'LO',
  'Emirates':'EK','Qatar Airways':'QR','Qatar':'QR','Etihad':'EY','Saudia':'SV','Royal Jordanian':'RJ',
  'Qantas':'QF','Air Canada':'AC','WestJet':'WS','Aeromexico':'AM','LATAM':'LA','Avianca':'AV','Copa':'CM',
  'Copa Airlines':'CM','Azul':'AD','GOL':'G3',
  'Singapore Airlines':'SQ','Cathay Pacific':'CX','ANA':'NH','All Nippon Airways':'NH','Japan Airlines':'JL',
  'JAL':'JL','Korean Air':'KE','Asiana':'OZ','China Southern':'CZ','China Eastern':'MU','Air China':'CA',
  'EVA Air':'BR','Thai Airways':'TG','Malaysia Airlines':'MH','Garuda Indonesia':'GA','Vietnam Airlines':'VN',
  'IndiGo':'6E','Air India':'AI','Ethiopian':'ET','Ethiopian Airlines':'ET','South African Airways':'SA',
  'Kenya Airways':'KQ','Royal Air Maroc':'AT','EgyptAir':'MS','El Al':'LY','Air New Zealand':'NZ','Fiji Airways':'FJ',
};
function iataFromName(name){ const first=String(name||'').split('/')[0].trim(); return AIRLINE_IATA[first]; }
function monoColor(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 55% 48%)`; }
function monoInitials(name){
  const w=String(name||'').replace(/[^A-Za-z ]/g,'').trim().split(/\s+/).filter(Boolean);
  if(!w.length) return '✈';
  return (w[0][0]+(w[1]?w[1][0]:'')).toUpperCase();
}
function airlineLogoHtml(q){
  const name=q.airline||'';
  const initials=monoInitials(name), color=monoColor(name||'x');
  const code=q.airlineCode||iataFromName(name);
  const src=q.airlineLogo||(code?`https://pics.avs.io/120/120/${code}.png`:'');
  if(src) return `<img class="flogo" src="${src}" alt="${escapeHtml(name)}" data-initials="${initials}" data-color="${color}" />`;
  return `<div class="flmono" style="background:${color}">${initials}</div>`;
}
/** Attach onerror fallbacks (CSP-safe: no inline handlers) so broken logos become monograms. */
function wireLogoFallbacks(root){
  root.querySelectorAll('img.flogo').forEach(img=>{
    const swap=()=>{ const d=document.createElement('div'); d.className='flmono'; d.style.background=img.dataset.color||'#9aa7b8'; d.textContent=img.dataset.initials||'✈'; img.replaceWith(d); };
    img.onerror=swap;
    if(img.complete && img.naturalWidth===0) swap();
  });
}
function fmtTime(t){ const m=String(t==null?'':t).match(/(\d{1,2}:\d{2})/); return m?m[1]:''; }

function legRow(l){
  if(!l.quote) return `<div class="flrow"><div class="flmono" style="background:#aab6c6">✈</div>
    <div><div class="flair">No flight found</div><div class="flsub">${l.origin} → ${l.destination} · ${l.date}</div></div>
    <div class="flmid">—</div><div class="flright"><div class="flprice soldout">—</div></div></div>`;
  const q=l.quote;
  const times=(fmtTime(q.departTime)&&fmtTime(q.arriveTime))?`${fmtTime(q.departTime)} – ${fmtTime(q.arriveTime)}`:l.date;
  const stops=q.stops===0?'Nonstop':(q.stops!=null?`${q.stops} stop${q.stops===1?'':'s'}`:'');
  const book=q.bookingUrl?`<a class="flbook" href="${q.bookingUrl}" target="_blank" rel="noopener">Select</a>`:'';
  return `<div class="flrow">
    ${airlineLogoHtml(q)}
    <div class="flinfo"><div class="flair">${escapeHtml(q.airline||'Flight')}</div><div class="flsub">${l.origin} → ${l.destination} · ${times}${q.seatsLeft===0?' · <span class="soldout">sold out at this fare</span>':''}</div></div>
    <div class="flmid">${stops?`<span class="flbadge${q.stops===0?' nonstop':''}">${stops}</span>`:''}<div class="fldur">${q.durationLabel||''}</div></div>
    <div class="flright"><div class="flprice">${money(q.price,q.currency)}</div>${book}</div>
  </div>`;
}

function valueScores(rows){
  const timed=rows.filter(r=>r.totalDurationMinutes!=null);
  if(!timed.length) return new Map();
  const ps=timed.map(r=>r.total), ts=timed.map(r=>r.totalDurationMinutes);
  const pMin=Math.min(...ps),pMax=Math.max(...ps),tMin=Math.min(...ts),tMax=Math.max(...ts);
  const norm=(v,lo,hi)=>hi>lo?(v-lo)/(hi-lo):0;
  const m=new Map();
  for(const r of rows){ m.set(r, r.totalDurationMinutes==null?Infinity:0.6*norm(r.total,pMin,pMax)+0.4*norm(r.totalDurationMinutes,tMin,tMax)); }
  return m;
}
function sortRows(rows,key){
  const c=rows.slice();
  if(key==='time') c.sort((a,b)=>(a.totalDurationMinutes??1e9)-(b.totalDurationMinutes??1e9));
  else if(key==='value'){ const m=valueScores(rows); c.sort((a,b)=>(m.get(a)??1e9)-(m.get(b)??1e9)); }
  else c.sort((a,b)=>a.total-b.total);
  return c;
}

function tripCard(it,rank,badges){
  const cur=STATE.spec.currency||'USD';
  const badgeHtml=badges.map(b=>`<span class="badge ${b.cls}">${b.lab}</span>`).join('');
  const origins = it.returnOrigin && it.returnOrigin!==it.origin ? `${it.origin} → ${it.returnOrigin}` : it.origin;
  return `<div class="trip${rank===1?' top':''}">
    <div class="trip-head">
      <div class="trip-rank">${rank}</div>
      <div class="trip-badges">${badgeHtml}</div>
      <div class="trip-cost"><div class="trip-price">${money(it.total,cur)}</div><div class="trip-time">${fmtMins(it.totalDurationMinutes)} · from ${origins}</div></div>
    </div>
    <div class="trip-explain">${escapeHtml(explain(it))}</div>
    <div class="trip-legs">${it.legs.map(legRow).join('')}</div>
  </div>`;
}

function render(){
  const { plan, spec, comparison } = STATE;
  const cur=spec.currency||'USD';
  if(!plan.best){
    show(`<div class="error">No fully-priceable itinerary found across ${plan.queriesRun} searches. Some legs returned no fare (check codes/dates, or the source lacks data for them).</div>`);
    return;
  }
  const gk={ cheap:itinKey(plan.best), fast:itinKey(plan.fastest), value:itinKey(plan.bestValue) };
  const sorted=sortRows(plan.allItineraries, STATE.sort);
  const top=sorted.slice(0,5);

  const cards=top.map((it,i)=>{
    const k=itinKey(it); const badges=[];
    if(k===gk.cheap) badges.push({cls:'cheap',lab:'Cheapest'});
    if(k===gk.fast) badges.push({cls:'fast',lab:'Fastest'});
    if(k===gk.value) badges.push({cls:'value',lab:'Best value'});
    return tripCard(it,i+1,badges);
  }).join('');

  const seg=(k,lab)=>`<button class="${STATE.sort===k?'act':''}" data-sort="${k}">${lab}</button>`;
  let html=`<div class="toolbar"><span class="lbl">Top 5 by</span><div class="seg">${seg('price','Cheapest')}${seg('time','Fastest')}${seg('value','Best value')}</div>`+
    `<button class="mini" id="csvBtn">⬇ Export CSV</button><button class="mini" id="saveBtn">★ Save</button>`+
    `<span class="lbl" style="margin-left:auto">${plan.allItineraries.length} options · ${plan.queriesRun} searches</span></div>`;
  html+=cards;

  // cross-check
  if(comparison){
    html+=`<div class="section-title">Price cross-check (per leg)</div><table><thead><tr><th>Leg</th>`+
      comparison.providerNames.map(n=>`<th class="num">${n}</th>`).join('')+`<th class="num">Δ</th></tr></thead><tbody>`;
    for(const r of comparison.rows){
      const cells=comparison.providerNames.map(n=>{ const q=r.quotes[n]; const star=n===r.cheapestProvider?' <span class="star">★</span>':''; return `<td class="num">${money(q?q.price:null,cur)}${star}</td>`; }).join('');
      html+=`<tr><td>${r.leg.origin}→${r.leg.destination} <span class="meta">${r.leg.date}</span></td>${cells}<td class="num">${r.spread?money(r.spread,cur):'—'}</td></tr>`;
    }
    html+=`</tbody></table>`;
  }

  // per-day matrix
  html+=`<div class="section-title">Per-day prices (cheapest fare &amp; time per date)</div><table><tbody>`;
  const byRoute={}; for(const l of plan.legGrid){ (byRoute[`${l.origin}→${l.destination}`]||=[]).push(l); }
  for(const [route,legs] of Object.entries(byRoute)){
    const priced=legs.filter(l=>l.quote); const minP=priced.length?Math.min(...priced.map(l=>l.quote.price)):null;
    const cells=legs.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(l=>{
      if(!l.quote) return `<span class="meta">${l.date}: —</span>`;
      const cheap=l.quote.price===minP?'cheapday':'';
      return `<span class="${cheap}">${l.date}: ${money(l.quote.price,cur)}</span> <span class="meta">(${fmtMins(l.quote.durationMinutes)})</span>`;
    }).join(' &nbsp; ');
    html+=`<tr><td><b>${route}</b></td><td>${cells}</td></tr>`;
  }
  html+=`</tbody></table>`;

  // all options
  html+=`<details><summary>All ${plan.allItineraries.length} options</summary><table><thead><tr><th>#</th><th class="num">Total</th><th class="num">Time</th><th>From</th><th>Start</th><th>Nights</th></tr></thead><tbody>`+
    sorted.slice(0,40).map((it,i)=>`<tr><td>${i+1}</td><td class="num">${money(it.total,cur)}</td><td class="num">${fmtMins(it.totalDurationMinutes)}</td><td>${it.returnOrigin&&it.returnOrigin!==it.origin?`${it.origin}→${it.returnOrigin}`:it.origin}</td><td>${it.startDate}</td><td>[${it.nightsPerStop.join(', ')}]</td></tr>`).join('')+
    `</tbody></table></details>`;
  html+=`<details><summary>Raw text plan</summary><pre>${escapeHtml(STATE.textPlan)}</pre></details>`;

  show(html);
  wireLogoFallbacks($('results'));
  document.querySelectorAll('#results .seg button').forEach(b=>b.onclick=()=>{ STATE.sort=b.dataset.sort; render(); });
  $('csvBtn').onclick=exportPlannerCsv;
  $('saveBtn').onclick=()=>{ saveTrip('planner'); flashSaved('saveBtn'); };
}

// ============================================================================
// "Plan my trip" advisor tab
// ============================================================================

// tab switching
const PANES=['planner','advisor','saved'];
function showTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('act', x.dataset.pane===name));
  PANES.forEach(n=>$('pane-'+n).classList.toggle('act', n===name));
  if(name==='saved') renderSavedList();
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.pane));

// advisor origins
function addAOrigin(code=''){
  const el=document.createElement('div'); el.className='origin-row';
  el.innerHTML=`<div class="combo"><input class="ao-code" aria-label="Origin airport code" value="${code}" placeholder="City or airport code…" autocomplete="off" /><div class="ac-menu"></div></div>
    <button type="button" class="xbtn" title="Remove origin" aria-label="Remove origin">✕</button>`;
  el.querySelector('.xbtn').onclick=()=>{ if(document.querySelectorAll('#a-origins .origin-row').length>1) el.remove(); };
  $('a-origins').appendChild(el); attachAutocomplete(el.querySelector('.ao-code'));
}
$('a-addOrigin').onclick=()=>addAOrigin();

// advisor destinations (label auto-fills with city)
function addADest(code='',label='',min='',max=''){
  const el=document.createElement('div'); el.className='stop';
  el.innerHTML=`
    <button type="button" class="xbtn" title="Remove place" aria-label="Remove place">✕</button>
    <div class="field" style="margin-bottom:8px"><label>Place</label>
      <div class="combo"><input class="ad-code" aria-label="Destination airport" value="${code}" placeholder="City or code…" autocomplete="off" /><div class="ac-menu"></div></div></div>
    <div class="row">
      <div class="field" style="margin-bottom:8px"><label>Label (auto-fills)</label><input class="ad-label" aria-label="Destination label" value="${label}" /></div>
      <div class="field" style="margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label>Min nights</label><input class="ad-min" aria-label="Min nights" type="number" min="1" placeholder="any" value="${min}" /></div>
        <div><label>Max nights</label><input class="ad-max" aria-label="Max nights" type="number" min="1" placeholder="any" value="${max}" /></div></div></div>`;
  el.querySelector('.xbtn').onclick=()=>{ if(document.querySelectorAll('#a-dests .stop').length>1) el.remove(); };
  $('a-dests').appendChild(el);
  const lab=el.querySelector('.ad-label');
  attachAutocomplete(el.querySelector('.ad-code'),(a)=>{ lab.value=a.city; });
}
$('a-addDest').onclick=()=>addADest();

// advisor provider hint
function aUpdateHint(){
  $('a-providerHint').textContent=HINTS[$('a-provider').value];
  credWarn($('a-provider').value,'a-keyWarn');
}
$('a-provider').onchange=aUpdateHint;

// seed an editable example (user can change to anywhere)
addAOrigin('PIT'); addAOrigin('CLE');
addADest('CDG','Paris'); addADest('FCO','Rome'); addADest('BER','Berlin');
aUpdateHint();

function readAdvisorSpec(){
  const origins=[...document.querySelectorAll('.ao-code')].map(i=>i.value.trim().toUpperCase()).filter(Boolean);
  if(!origins.length) throw new Error('Add at least one origin airport.');
  const destinations=[...document.querySelectorAll('#a-dests .stop')].map(el=>{
    const min=qsv(el,'.ad-min'), max=qsv(el,'.ad-max');
    return { code:qsv(el,'.ad-code').trim().toUpperCase(), label:qsv(el,'.ad-label').trim()||undefined,
      minNights:min?Number(min):undefined, maxNights:max?Number(max):undefined };
  }).filter(d=>d.code);
  if(!destinations.length) throw new Error('Add at least one place to visit.');
  return { origins, destinations, startDate:val('a-startDate'), latestReturn:val('a-latestReturn')||undefined,
    totalNights:Number(val('a-totalNights')), returnToOrigin:$('a-returnToOrigin').checked,
    optimizeGeography:$('a-optimizeGeography').checked,
    adults:Number(val('a-adults')), cabin:val('a-cabin'), currency:val('a-currency').trim().toUpperCase()||'USD' };
}

let ASTATE=null;
function ashow(html){ $('a-results').innerHTML=`<div class="results-head"><h2>Best routes</h2></div>${html}`; }
const acityOf=(c)=>(ASTATE.cityByCode&&ASTATE.cityByCode[c])||c;
const aKey=(it)=>it?`${it.origin}>${it.returnOrigin||''}|${it.order.join('-')}|${it.startDate}|${it.nightsPerStop.join(',')}`:'';
const aRoute=(it)=>`${acityOf(it.origin)} → ${it.order.map(acityOf).join(' → ')} → ${acityOf(it.returnOrigin||it.origin)}`;

function aexplain(it){
  const segs=it.order.map((code,i)=>{ const n=it.nightsPerStop[i]; return `${acityOf(code)} (${n} night${n===1?'':'s'})`; });
  let s=`Depart ${acityOf(it.origin)} on ${it.startDate}. Visit ${joinSeq(segs)}.`;
  if(it.returnOrigin){ s+= it.returnOrigin===it.origin
      ? ` Then fly home to ${acityOf(it.returnOrigin)}.`
      : ` Then fly home into ${acityOf(it.returnOrigin)} — cheaper than returning to ${acityOf(it.origin)}.`; }
  const total=it.nightsPerStop.reduce((a,b)=>a+b,0);
  s+=` ${total} nights total · ${fmtMins(it.totalDurationMinutes)} in the air.`;
  return s;
}

function aTripCard(it,rank,badges){
  const cur=ASTATE.spec.currency||'USD';
  const badgeHtml=badges.map(b=>`<span class="badge ${b.cls}">${b.lab}</span>`).join('');
  return `<div class="trip${rank===1?' top':''}">
    <div class="trip-head">
      <div class="trip-rank">${rank}</div>
      <div class="trip-badges">${badgeHtml}</div>
      <div class="trip-cost"><div class="trip-price">${money(it.total,cur)}</div><div class="trip-time">${fmtMins(it.totalDurationMinutes)}</div></div>
    </div>
    <div class="trip-route">${escapeHtml(aRoute(it))}</div>
    <div class="trip-explain">${escapeHtml(aexplain(it))}</div>
    <div class="trip-legs">${it.legs.map(legRow).join('')}</div>
  </div>`;
}

$('aform').onsubmit=async(e)=>{
  e.preventDefault(); const btn=$('a-run'); btn.disabled=true; btn.textContent='Planning…';
  ashow(`<div class="empty"><span class="spinner"></span> Searching every route…</div>`);
  try {
    const res=await fetch('/api/plan-trip',{ method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ spec:readAdvisorSpec(), provider:$('a-provider').value }) });
    const data=await res.json();
    if(!data.ok) throw new Error(data.error||'Request failed');
    ASTATE={ result:data.result, spec:data.spec, cityByCode:data.cityByCode, sort:'price' };
    renderAdvisor();
  } catch(err){ ashow(`<div class="error"><b>Error:</b> ${escapeHtml(err.message)}</div>`); }
  finally { btn.disabled=false; btn.textContent='✦ Plan my trip'; }
};

function renderAdvisor(){
  const r=ASTATE.result, cur=ASTATE.spec.currency||'USD';
  if(!r.best){ ashow(`<div class="error">No complete route could be priced across ${r.queriesRun} searches. Try a wider date window or different airports.</div>`); return; }
  const gk={ cheap:aKey(r.best), fast:aKey(r.fastest), value:aKey(r.bestValue) };
  const sorted=sortRows(r.allItineraries, ASTATE.sort);
  const top=sorted.slice(0,5);
  const cards=top.map((it,i)=>{ const k=aKey(it); const badges=[];
    if(k===gk.cheap) badges.push({cls:'cheap',lab:'Cheapest'});
    if(k===gk.fast) badges.push({cls:'fast',lab:'Fastest'});
    if(k===gk.value) badges.push({cls:'value',lab:'Best value'});
    return aTripCard(it,i+1,badges);
  }).join('');
  const seg=(k,lab)=>`<button class="${ASTATE.sort===k?'act':''}" data-asort="${k}">${lab}</button>`;
  let html=`<div class="toolbar"><span class="lbl">Top 5 by</span><div class="seg">${seg('price','Cheapest')}${seg('time','Fastest')}${seg('value','Best value')}</div>`+
    `<button class="mini" id="a-csvBtn">⬇ Export CSV</button><button class="mini" id="a-saveBtn">★ Save</button>`+
    `<span class="lbl" style="margin-left:auto">${r.ordersPriced}/${r.permutationsTried} orders · ${r.routesConsidered.toLocaleString()} routes · ${r.queriesRun} searches</span></div>`;
  if(r.sampled) html+=`<div class="banner warn">Wide search: I sampled start dates (every ${r.dateStepDays} day${r.dateStepDays===1?'':'s'}) and some trip-length splits to stay fast. Narrow the date window or set per-place night ranges for finer results.</div>`;
  html+=cards;
  html+=`<details><summary>More routes (${r.allItineraries.length})</summary><table><thead><tr><th>#</th><th class="num">Total</th><th class="num">Time</th><th>Route</th><th>Nights</th><th>Start</th></tr></thead><tbody>`+
    sorted.map((it,i)=>`<tr><td>${i+1}</td><td class="num">${money(it.total,cur)}</td><td class="num">${fmtMins(it.totalDurationMinutes)}</td><td>${escapeHtml(aRoute(it))}</td><td>[${it.nightsPerStop.join(', ')}]</td><td>${it.startDate}</td></tr>`).join('')+
    `</tbody></table></details>`;
  ashow(html);
  wireLogoFallbacks($('a-results'));
  document.querySelectorAll('#a-results .seg button').forEach(b=>b.onclick=()=>{ ASTATE.sort=b.dataset.asort; renderAdvisor(); });
  $('a-csvBtn').onclick=exportAdvisorCsv;
  $('a-saveBtn').onclick=()=>{ saveTrip('advisor'); flashSaved('a-saveBtn'); };
}

// ============================================================================
// CSV export + Saved trips
// ============================================================================
function csvCell(v){ const s=String(v==null?'':v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function downloadFile(name, text, mime){
  const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function pathLabel(it){ return [...it.legs.map(l=>l.origin), it.legs[it.legs.length-1].destination].join(' → '); }

function legsToCsvRows(itins, routeLabelFn){
  const header=['Option','Route','From','To','Date','Airline','Stops','Duration','Price','Currency','Book'];
  const rows=[header];
  itins.forEach((it,i)=>{
    it.legs.forEach(l=>{ const q=l.quote||{};
      rows.push([i+1, routeLabelFn(it), l.origin, l.destination, l.date, q.airline||'', q.stops==null?'':q.stops, q.durationLabel||'', q.price==null?'':q.price, q.currency||'', q.bookingUrl||'']);
    });
  });
  return rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
function exportPlannerCsv(){
  if(!STATE||!STATE.plan) return;
  downloadFile('flight-plan.csv', legsToCsvRows(STATE.plan.allItineraries.slice(0,5), pathLabel), 'text/csv;charset=utf-8');
}
function exportAdvisorCsv(){
  if(!ASTATE||!ASTATE.result) return;
  downloadFile('plan-my-trip.csv', legsToCsvRows(ASTATE.result.allItineraries.slice(0,5), aRoute), 'text/csv;charset=utf-8');
}

const SAVED_KEY='ff_saved';
function loadSaved(){ try { return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]'); } catch { return []; } }
function persistSaved(items){ localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0,30))); }
function flashSaved(id){ const b=$(id); if(!b) return; const t=b.textContent; b.textContent='Saved ✓'; setTimeout(()=>{ b.textContent=t; }, 1500); }

function saveTrip(kind){
  const items=loadSaved();
  let label, data;
  if(kind==='planner'){
    if(!STATE||!STATE.plan||!STATE.plan.best) return;
    const b=STATE.plan.best; label=`${pathLabel(b)} · ${money(b.total, STATE.spec.currency||'USD')}`;
    data={...STATE, plan:{...STATE.plan, allItineraries:STATE.plan.allItineraries.slice(0,10)}};
  } else {
    if(!ASTATE||!ASTATE.result||!ASTATE.result.best) return;
    const b=ASTATE.result.best; label=`${aRoute(b)} · ${money(b.total, ASTATE.spec.currency||'USD')}`;
    data={...ASTATE, result:{...ASTATE.result, allItineraries:ASTATE.result.allItineraries.slice(0,10)}};
  }
  items.unshift({ id:Date.now()+'-'+Math.random().toString(36).slice(2), kind, label, savedAt:new Date().toISOString(), data });
  persistSaved(items);
}
function deleteSaved(id){ persistSaved(loadSaved().filter(e=>e.id!==id)); renderSavedList(); }
function viewSaved(id){
  const e=loadSaved().find(x=>x.id===id); if(!e) return;
  if(e.kind==='imported'){ renderImported(e.data, $('saved-view')); $('saved-view').scrollIntoView({behavior:'smooth',block:'start'}); return; }
  if(e.kind==='planner'){ STATE=e.data; STATE.sort='price'; showTab('planner'); render(); }
  else { ASTATE=e.data; ASTATE.sort='price'; showTab('advisor'); renderAdvisor(); }
}
const KIND_LABEL={ planner:'Multi-city planner', advisor:'Plan my trip', imported:'Imported CSV' };
const KIND_ICON={ advisor:'✦ ', imported:'⬆ ', planner:'' };
function renderSavedList(){
  const items=loadSaved();
  if(!items.length){ $('saved-list').innerHTML=`<div class="empty">No saved trips yet. Run a search and click <b>★ Save</b>, or <b>import a CSV</b> above.</div>`; return; }
  $('saved-list').innerHTML=items.map(e=>`<div class="saved-row">
    <div><div style="font-weight:600">${KIND_ICON[e.kind]||''}${escapeHtml(e.label)}</div>
      <div class="meta">${KIND_LABEL[e.kind]||e.kind} · saved ${escapeHtml(new Date(e.savedAt).toLocaleString())}</div></div>
    <div style="display:flex;gap:8px"><button class="mini" data-view="${e.id}">View</button><button class="xbtn" data-del="${e.id}" title="Delete" aria-label="Delete">✕</button></div>
  </div>`).join('');
  $('saved-list').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>viewSaved(b.dataset.view));
  $('saved-list').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteSaved(b.dataset.del));
}

// --- CSV import (repopulate a saved trip without using searches) --------------
function parseCsv(text){
  const rows=[]; let field='', row=[], inQ=false; const n=text.length;
  for(let i=0;i<n;i++){ const c=text[i];
    if(inQ){ if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else inQ=false; } else field+=c; continue; }
    if(c==='"'){ inQ=true; }
    else if(c===','){ row.push(field); field=''; }
    else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(field); if(row.some(x=>x!=='')) rows.push(row); row=[]; field=''; }
    else field+=c;
  }
  if(field!==''||row.length){ row.push(field); if(row.some(x=>x!=='')) rows.push(row); }
  return rows;
}
function parseDurLabel(s){ const h=/(\d+)\s*h/i.exec(s||''), m=/(\d+)\s*m/i.exec(s||''); if(!h&&!m) return undefined; return (h?+h[1]*60:0)+(m?+m[1]:0); }
function importCsvText(text, fileName){
  const rows=parseCsv(text); if(rows.length<2) throw new Error('CSV looks empty.');
  const head=rows[0].map(h=>h.trim().toLowerCase());
  const ix=name=>head.indexOf(name);
  const iOpt=ix('option'), iFrom=ix('from'), iTo=ix('to'), iDate=ix('date'), iAir=ix('airline'),
        iStops=ix('stops'), iDur=ix('duration'), iPrice=ix('price'), iCur=ix('currency'), iBook=ix('book');
  if(iFrom<0||iTo<0||iPrice<0) throw new Error('Need at least From, To and Price columns.');
  const groups=new Map();
  for(let r=1;r<rows.length;r++){ const row=rows[r]; if(!row[iFrom]) continue;
    const opt=iOpt>=0?(row[iOpt]||'1'):'1';
    if(!groups.has(opt)) groups.set(opt,[]);
    const dur=iDur>=0?row[iDur]:'';
    groups.get(opt).push({ origin:(row[iFrom]||'').trim().toUpperCase(), destination:(row[iTo]||'').trim().toUpperCase(), date:(iDate>=0?row[iDate]:'').trim(),
      quote:{ price:Number(String(row[iPrice]).replace(/[^0-9.]/g,''))||0, currency:(iCur>=0&&row[iCur]?row[iCur]:'USD').trim().toUpperCase(),
        airline:iAir>=0?row[iAir]:'', stops:(iStops>=0&&row[iStops]!=='')?Number(row[iStops]):undefined,
        durationLabel:dur, durationMinutes:parseDurLabel(dur), bookingUrl:iBook>=0?row[iBook]:'' } });
  }
  if(!groups.size) throw new Error('No flight rows found.');
  const itins=[...groups.values()].map(legs=>{
    const total=legs.reduce((s,l)=>s+(l.quote.price||0),0);
    const dm=legs.map(l=>l.quote.durationMinutes);
    return { origin:legs[0].origin, returnOrigin:legs[legs.length-1].destination, legs, total,
      currency:legs[0].quote.currency||'USD', totalDurationMinutes: dm.every(d=>typeof d==='number')?dm.reduce((a,b)=>a+b,0):null };
  }).sort((a,b)=>a.total-b.total);
  return { itins, fileName };
}
function importedCard(it, rank){
  const cur=it.currency||'USD';
  const route=[...it.legs.map(l=>l.origin), it.legs[it.legs.length-1].destination].join(' → ');
  return `<div class="trip${rank===1?' top':''}"><div class="trip-head"><div class="trip-rank">${rank}</div><div class="trip-badges"></div>
    <div class="trip-cost"><div class="trip-price">${money(it.total,cur)}</div><div class="trip-time">${fmtMins(it.totalDurationMinutes)}</div></div></div>
    <div class="trip-route">${escapeHtml(route)}</div>
    <div class="trip-legs">${it.legs.map(legRow).join('')}</div></div>`;
}
function renderImported(data, container){
  if(!data||!data.itins||!data.itins.length){ container.innerHTML=''; return; }
  container.innerHTML=`<div class="section-title">Imported — ${escapeHtml(data.fileName||'CSV')} · ${data.itins.length} option(s) · no searches used</div>`+
    data.itins.slice(0,12).map((it,i)=>importedCard(it,i+1)).join('');
  wireLogoFallbacks(container);
}
function saveImported(data){
  const items=loadSaved();
  items.unshift({ id:Date.now()+'-'+Math.random().toString(36).slice(2), kind:'imported',
    label:`${escapeHtml(data.fileName)} · ${data.itins.length} option(s)`, savedAt:new Date().toISOString(), data });
  persistSaved(items); renderSavedList();
}
$('csvUpload').onchange=(e)=>{
  const f=e.target.files&&e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ try { const data=importCsvText(String(rd.result), f.name); saveImported(data); renderImported(data, $('saved-view')); $('importMsg').textContent=`Imported ${data.itins.length} option(s) from ${f.name}.`; }
    catch(err){ $('importMsg').textContent='Import failed: '+err.message; } };
  rd.onerror=()=>{ $('importMsg').textContent='Could not read the file.'; };
  rd.readAsText(f); e.target.value='';
};
