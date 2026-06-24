const $ = (id) => document.getElementById(id);
const money = (n,c) => n==null ? '—' : `${c} ${Number(n).toFixed(2)}`;
const fmtMins = (m) => m==null ? '—' : `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf = (n) => Number(n).toLocaleString('en-US');

// ---- points programs (cents-per-point defaults) -----------------------------
const POINTS_PROGRAMS = [
  ['Chase Ultimate Rewards',2.0],['Amex Membership Rewards',2.0],['Capital One Miles',1.85],
  ['Citi ThankYou',1.8],['Bilt Rewards',2.05],['United MileagePlus',1.35],['American AAdvantage',1.4],
  ['Delta SkyMiles',1.2],['Southwest Rapid Rewards',1.4],['JetBlue TrueBlue',1.3],
  ['Alaska Mileage Plan',1.45],['Air Canada Aeroplan',1.5],['British Airways Avios',1.5],['Virgin Atlantic Points',1.5],
];
const CPP = Object.fromEntries(POINTS_PROGRAMS.map(([n,c])=>[n,c]));
$('progList').innerHTML = POINTS_PROGRAMS.map(([n])=>`<option value="${n}">`).join('');

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
  el.querySelector('.xbtn').onclick=()=>{ if(document.querySelectorAll('.origin-row').length>1) el.remove(); };
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
  el.querySelector('.xbtn').onclick=()=>{ if(document.querySelectorAll('.stop').length>1) el.remove(); };
  $('stops').appendChild(el);
  const lab=el.querySelector('.s-label');
  lab.addEventListener('input',()=>{ lab.dataset.auto=''; });
  attachAutocomplete(el.querySelector('.s-code'),(a)=>{ if(!lab.value || lab.dataset.auto==='1'){ lab.value=a.city; lab.dataset.auto='1'; } });
}
$('addStop').onclick=()=>addStop();

// ---- points program rows ----------------------------------------------------
function addProgram(name='',cpp='',balance=''){
  const el=document.createElement('div'); el.className='prog-row';
  el.innerHTML=`<input class="p-name" aria-label="Points program" list="progList" placeholder="Program" value="${name}" />
    <input class="p-cpp" aria-label="Cents per point" type="number" step="0.05" min="0" placeholder="¢/pt" value="${cpp}" />
    <input class="p-bal" aria-label="Points balance" type="number" min="0" placeholder="balance" value="${balance}" />
    <button type="button" class="xbtn" title="Remove program" aria-label="Remove program">✕</button>`;
  el.querySelector('.xbtn').onclick=()=>el.remove();
  const nameI=el.querySelector('.p-name'), cppI=el.querySelector('.p-cpp');
  nameI.addEventListener('input',()=>{ if(CPP[nameI.value] && !cppI.value) cppI.value=CPP[nameI.value]; });
  nameI.addEventListener('change',()=>{ if(CPP[nameI.value]) cppI.value=CPP[nameI.value]; });
  $('programs').appendChild(el);
}
$('addProgram').onclick=()=>addProgram();
function readPrograms(){
  return [...document.querySelectorAll('.prog-row')].map(el=>({
    name: el.querySelector('.p-name').value.trim(),
    cpp: Number(el.querySelector('.p-cpp').value),
    balance: Number(el.querySelector('.p-bal').value)||0,
  })).filter(p=>p.name && p.cpp>0);
}

// seed defaults
addOrigin('SFO');
addStop('JFK','New York',2,3);
addStop('LHR','London',3,4);

// ---- provider hint + key warning -------------------------------------------
const HINTS={ mock:'Deterministic fake prices. Works for any route instantly — great for trying the UI.',
  serpapi:'Real fares via your SERPAPI_KEY (in .env). One billed search per unique leg/date.',
  crosscheck:'SerpApi live vs the Expedia snapshot, picks the cheaper per leg. Expedia data only covers the seeded SFO/JFK/LHR July-2026 legs.' };
let HAS_KEY=true;
function updateHint(){
  $('providerHint').textContent=HINTS[$('provider').value];
  const needsKey=$('provider').value!=='mock';
  $('keyWarn').innerHTML=(needsKey&&!HAS_KEY)
    ? `<div class="banner warn">No <b>SERPAPI_KEY</b> detected. Create <code>flight-planner/.env</code> with your key, or use <b>Mock</b> to test now.</div>` : '';
}
$('provider').onchange=updateHint;
fetch('/api/config').then(r=>r.json()).then(c=>{ HAS_KEY=!!c.hasSerpApiKey; updateHint(); }).catch(()=>{});
updateHint();

// ---- submit -----------------------------------------------------------------
function val(id){ const el=$(id); if(!el) throw new Error(`UI out of date (missing #${id}). Hard-refresh the page (Ctrl+F5).`); return el.value; }
function qsv(el,sel){ const n=el.querySelector(sel); return n?n.value:''; }
function readSpec(){
  const origins=[...document.querySelectorAll('.o-code')].map(i=>i.value.trim().toUpperCase()).filter(Boolean);
  if(!origins.length) throw new Error('Add at least one origin airport.');
  const stops=[...document.querySelectorAll('.stop')].map(el=>({
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
    STATE=data; STATE.sort='price'; PROGRAMS=readPrograms(); render();
  } catch(err){ show(`<div class="error"><b>Error:</b> ${escapeHtml(err.message)}</div>`); }
  finally { btn.disabled=false; btn.textContent='Search flights'; }
};

// ---- rendering --------------------------------------------------------------
let STATE=null, PROGRAMS=[];
function show(html){ $('results').innerHTML=`<h2>Results</h2>${html}`; }
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

function legRow(l){
  if(!l.quote) return `<div class="leg"><div><div class="route">${l.origin}→${l.destination}</div><div class="meta">${l.date}</div></div><div class="right"><div class="price soldout">no fare</div></div></div>`;
  const q=l.quote;
  const meta=[q.airline,q.stops!=null?`${q.stops} stop${q.stops===1?'':'s'}`:'',q.durationLabel,q.bookingLabel,q.seatsLeft===0?'sold out at this fare':''].filter(Boolean).join(' · ');
  const book=q.bookingUrl?`<a class="booklink" href="${q.bookingUrl}" target="_blank" rel="noopener">Book ↗</a>`:'';
  return `<div class="leg"><div><div class="route">${l.origin}→${l.destination} <span class="meta">${l.date}</span></div><div class="meta">${escapeHtml(meta)}</div></div><div class="right"><div class="price">${money(q.price,q.currency)}</div>${book}</div></div>`;
}

function pointsBlock(it){
  if(!PROGRAMS.length) return '';
  const items=PROGRAMS.map(p=>{
    const pts=Math.round(it.total*100/p.cpp);
    let cover='';
    if(p.balance>0) cover = p.balance>=pts ? `<span class="ok">✓ covered (have ${nf(p.balance)})</span>` : `<span class="short">short ${nf(pts-p.balance)}</span>`;
    return `<div class="pt"><span class="pt-name">${escapeHtml(p.name)}</span><b>~${nf(pts)} pts</b><span class="pt-cpp">@ ${p.cpp}¢/pt</span> ${cover}</div>`;
  }).join('');
  return `<div class="trip-points"><div class="pt-title">Estimated points cost (estimate, not live award pricing)</div>${items}</div>`;
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
      <div class="trip-rank">#${rank}</div>
      <div class="trip-badges">${badgeHtml}</div>
      <div class="trip-cost"><div class="trip-price">${money(it.total,cur)}</div><div class="trip-time">${fmtMins(it.totalDurationMinutes)} · from ${origins}</div></div>
    </div>
    <div class="trip-explain">${escapeHtml(explain(it))}</div>
    <div class="trip-legs">${it.legs.map(legRow).join('')}</div>
    ${pointsBlock(it)}
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
  document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{ STATE.sort=b.dataset.sort; render(); });
}
