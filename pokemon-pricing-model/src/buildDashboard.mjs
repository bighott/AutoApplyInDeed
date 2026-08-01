// Generates a self-contained interactive dashboard (public/dashboard.html) from
// data/cards.json. The page embeds the card data plus a faithful JS port of the
// model so the regression RE-FITS live in the browser as you drag the
// desirability weight sliders — a working reproduction of the video's model,
// not a static screenshot.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const cardsPath = join(here, '..', 'data', 'cards.json');
const outPath = join(here, '..', 'public', 'dashboard.html');

const raw = JSON.parse(await readFile(cardsPath, 'utf8'));
const cards = raw.cards ?? raw;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pokémon Chase-Card Pricing Model</title>
<style>
  :root{
    --bg:#0f1117; --panel:#171a23; --panel2:#1e222e; --line:#2a2f3d;
    --text:#e8ebf2; --muted:#98a0b3; --accent:#ffcb05; --accent2:#3d7dca;
    --over:#ff5c7c; --under:#25c281; --fair:#8891a5;
  }
  @media (prefers-color-scheme: light){
    :root{ --bg:#f5f6fa; --panel:#ffffff; --panel2:#f0f2f7; --line:#e2e5ee;
      --text:#1a1d27; --muted:#5c6478; --over:#e0335c; --under:#12925f; --fair:#7a8296; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:1120px;margin:0 auto;padding:28px 20px 64px}
  h1{font-size:26px;margin:0 0 4px;letter-spacing:-.3px}
  h1 .b{color:var(--accent)}
  .sub{color:var(--muted);margin:0 0 22px;max-width:70ch}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:22px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .stat .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .stat .v{font-size:22px;font-weight:650;margin-top:3px}
  .stat .v small{font-size:13px;color:var(--muted);font-weight:400}
  .grid{display:grid;grid-template-columns:1fr;gap:18px}
  @media(min-width:900px){.grid{grid-template-columns:1.35fr .9fr}}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .panel h2{font-size:14px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 12px}
  .chart-wrap{overflow-x:auto}
  svg{display:block;max-width:100%;height:auto}
  .dot{cursor:pointer;transition:opacity .12s}
  .dot:hover{opacity:1 !important}
  .axis{stroke:var(--line)}
  .axistext{fill:var(--muted);font-size:11px}
  .fairline{stroke:var(--fair);stroke-dasharray:5 4;stroke-width:1.4}
  .band{fill:var(--fair);opacity:.07}
  .controls label{display:block;font-size:12px;color:var(--muted);margin:14px 0 4px}
  .controls .row{display:flex;align-items:center;gap:10px}
  .controls input[type=range]{flex:1;accent-color:var(--accent2)}
  .controls .val{width:46px;text-align:right;font-variant-numeric:tabular-nums}
  .note{font-size:12px;color:var(--muted);margin-top:10px}
  button.reset{margin-top:14px;background:var(--panel2);color:var(--text);border:1px solid var(--line);
    border-radius:8px;padding:7px 12px;cursor:pointer;font-size:13px}
  button.reset:hover{border-color:var(--accent2)}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;cursor:pointer;user-select:none}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11.5px;font-weight:650}
  .pill.OVERVALUED{background:color-mix(in srgb,var(--over) 20%,transparent);color:var(--over)}
  .pill.UNDERVALUED{background:color-mix(in srgb,var(--under) 20%,transparent);color:var(--under)}
  .pill.FAIR{background:color-mix(in srgb,var(--fair) 22%,transparent);color:var(--fair)}
  .tip{position:fixed;pointer-events:none;background:var(--panel2);border:1px solid var(--line);
    border-radius:10px;padding:10px 12px;font-size:12.5px;max-width:260px;opacity:0;transition:opacity .1s;
    box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:10}
  .tip .t{font-weight:650;margin-bottom:4px}
  .tip .r{display:flex;justify-content:space-between;gap:16px;color:var(--muted)}
  .tip .r b{color:var(--text);font-weight:600}
  .disc{font-size:12px;color:var(--muted);margin-top:26px;border-top:1px solid var(--line);padding-top:14px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Pokémon <span class="b">Chase-Card</span> Pricing Model</h1>
  <p class="sub">Two forces set a modern chase card's price: <b>supply</b> (how many packs you must rip to pull it) and <b>demand</b> (a desirability index of character premium, artwork/hype, and search interest). The model fits <code>ln(price)</code> on both, then flags cards trading above or below the line. Drag the weights to re-fit live.</p>

  <div class="cards" id="stats"></div>

  <div class="grid">
    <div class="panel">
      <h2>Market price vs. model prediction</h2>
      <div class="chart-wrap"><svg id="chart" viewBox="0 0 640 460" role="img" aria-label="Scatter of market vs predicted price"></svg></div>
      <p class="note">Log–log axes. Dashed line = fair value (market = model). Above it → <span style="color:var(--over)">overvalued</span>; below → <span style="color:var(--under)">undervalued</span>. Shaded band = ±<span id="bandlbl">15</span>%.</p>
    </div>

    <div class="panel controls">
      <h2>Desirability weights</h2>
      <label>Character premium <span class="val" id="wcv"></span></label>
      <div class="row"><input type="range" id="wc" min="0" max="100" step="5"></div>
      <label>Artwork / hype <span class="val" id="wav"></span></label>
      <div class="row"><input type="range" id="wa" min="0" max="100" step="5"></div>
      <label>Universal appeal (Trends) <span class="val" id="wtv"></span></label>
      <div class="row"><input type="range" id="wt" min="0" max="100" step="5"></div>
      <label>Fair-value band ±<span class="val" id="fbv"></span></label>
      <div class="row"><input type="range" id="fb" min="5" max="40" step="5"></div>
      <button class="reset" id="reset">Reset to video defaults (45 / 45 / 10)</button>
      <p class="note">Weights auto-normalize to 100%. Every change re-runs the full OLS fit in your browser.</p>
    </div>
  </div>

  <div class="panel" style="margin-top:18px">
    <h2>Card ledger <span style="text-transform:none;font-weight:400">— click a header to sort</span></h2>
    <div style="overflow-x:auto">
    <table id="tbl">
      <thead><tr>
        <th data-k="name">Card</th><th data-k="set">Set</th>
        <th class="num" data-k="pullCostScore">Pull</th>
        <th class="num" data-k="desirabilityScore">Desir</th>
        <th class="num" data-k="marketPrice">Market</th>
        <th class="num" data-k="predictedPrice">Model</th>
        <th class="num" data-k="valuationGap">Gap</th>
        <th data-k="verdict">Verdict</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    </div>
  </div>

  <p class="disc">${(raw._note || 'Illustrative data.').replace(/</g, '&lt;')}</p>
</div>
<div class="tip" id="tip"></div>

<script>
const CARDS = ${JSON.stringify(cards)};

// ---- model port (mirrors src/model.mjs) ----
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const characterScore=r=>clamp(10/Math.max(r,1e-9),1,10);
const expectedPacks=c=>c.packsPerRarityHit*c.chaseCardsInTier;
function logNorm(vals){const L=vals.map(v=>Math.log(Math.max(v,1e-9)));
  const mn=Math.min(...L),mx=Math.max(...L),sp=(mx-mn)||1;return L.map(l=>1+9*((l-mn)/sp));}
function score(cards,w){
  const packs=cards.map(expectedPacks),ps=logNorm(packs);
  return cards.map((c,i)=>({...c,pullCostScore:ps[i],characterScore:characterScore(c.characterRank),
    desirabilityScore:w.c*characterScore(c.characterRank)+w.a*clamp(c.artworkHype,1,10)+w.t*clamp(c.googleTrends,1,10)}));
}
function fit(sc){
  const rows=sc.filter(c=>c.marketPrice>0);
  const X=rows.map(c=>[1,c.pullCostScore,c.desirabilityScore]),y=rows.map(c=>Math.log(c.marketPrice));
  const A=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];
  for(const r of X)for(let i=0;i<3;i++){for(let j=0;j<3;j++)A[i][j]+=r[i]*r[j];}
  for(let r=0;r<X.length;r++)for(let i=0;i<3;i++)b[i]+=X[r][i]*y[r];
  const[a,bb,c]=A[0],[d,e,f]=A[1],[g,h,ii]=A[2];
  const M=e*ii-f*h,N=-(d*ii-f*g),O=d*h-e*g,det=a*M+bb*N+c*O;
  const D=-(bb*ii-c*h),E=a*ii-c*g,F=-(a*h-bb*g),G=bb*f-c*e,H=-(a*f-c*d),I=a*e-bb*d;
  const inv=[[M/det,D/det,G/det],[N/det,E/det,H/det],[O/det,F/det,I/det]];
  const beta=inv.map(row=>row[0]*b[0]+row[1]*b[1]+row[2]*b[2]);
  const yh=X.map(x=>x[0]*beta[0]+x[1]*beta[1]+x[2]*beta[2]);
  const mean=y.reduce((s,v)=>s+v,0)/y.length;let sr=0,st=0;
  for(let i=0;i<y.length;i++){sr+=(y[i]-yh[i])**2;st+=(y[i]-mean)**2;}
  return{b0:beta[0],b1:beta[1],b2:beta[2],r2:st?1-sr/st:0,n:rows.length};
}
const predict=(m,c)=>Math.exp(m.b0+m.b1*c.pullCostScore+m.b2*c.desirabilityScore);

// ---- state ----
let W={c:45,a:45,t:10}, BAND=15, sortK='valuationGap', sortDir=-1;
const $=id=>document.getElementById(id);
const money=n=>'$'+Math.round(n).toLocaleString('en-US');
const pct=n=>(n>=0?'+':'')+(n*100).toFixed(0)+'%';

function compute(){
  const w={c:W.c/(W.c+W.a+W.t),a:W.a/(W.c+W.a+W.t),t:W.t/(W.c+W.a+W.t)};
  const sc=score(CARDS,w), m=fit(sc);
  const res=sc.map(c=>{const p=predict(m,c);const gap=(c.marketPrice-p)/p;
    return{...c,predictedPrice:p,valuationGap:gap,
      verdict:gap>BAND/100?'OVERVALUED':gap<-BAND/100?'UNDERVALUED':'FAIR'};});
  return{m,res};
}

function renderStats(m,res){
  const over=res.filter(c=>c.verdict==='OVERVALUED').sort((a,b)=>b.valuationGap-a.valuationGap)[0];
  const under=res.filter(c=>c.verdict==='UNDERVALUED').sort((a,b)=>a.valuationGap-b.valuationGap)[0];
  $('stats').innerHTML=[
    ['Model fit (R²)', m.r2.toFixed(2), 'variation explained'],
    ['Pull cost', pct(Math.exp(m.b1)-1), 'price per +1 point'],
    ['Desirability', pct(Math.exp(m.b2)-1), 'price per +1 point'],
    ['Most overvalued', over?over.name.split(' (')[0]:'—', over?pct(over.valuationGap):''],
    ['Most undervalued', under?under.name.split(' (')[0]:'—', under?pct(under.valuationGap):''],
  ].map(([k,v,s])=>\`<div class="stat"><div class="k">\${k}</div><div class="v">\${v} <small>\${s}</small></div></div>\`).join('');
}

function renderChart(res){
  const W_=640,H=460,pad=54;
  const priced=res.filter(c=>c.marketPrice>0);
  const all=priced.flatMap(c=>[c.marketPrice,c.predictedPrice]);
  const lo=Math.log10(Math.min(...all)*0.8), hi=Math.log10(Math.max(...all)*1.2);
  const sx=v=>pad+(Math.log10(v)-lo)/(hi-lo)*(W_-pad-16);
  const sy=v=>H-pad-(Math.log10(v)-lo)/(hi-lo)*(H-pad-16);
  const svg=[];
  // fair band (market within ±band of predicted → around y=x)
  const bf=BAND/100;
  const corners=[[Math.pow(10,lo),Math.pow(10,lo)*(1+bf)],[Math.pow(10,hi),Math.pow(10,hi)*(1+bf)],
    [Math.pow(10,hi),Math.pow(10,hi)*(1-bf)],[Math.pow(10,lo),Math.pow(10,lo)*(1-bf)]];
  svg.push(\`<polygon class="band" points="\${corners.map(([x,y])=>sx(x)+','+sy(y)).join(' ')}"/>\`);
  svg.push(\`<line class="fairline" x1="\${sx(Math.pow(10,lo))}" y1="\${sy(Math.pow(10,lo))}" x2="\${sx(Math.pow(10,hi))}" y2="\${sy(Math.pow(10,hi))}"/>\`);
  // axes + ticks
  svg.push(\`<line class="axis" x1="\${pad}" y1="\${H-pad}" x2="\${W_-16}" y2="\${H-pad}"/>\`);
  svg.push(\`<line class="axis" x1="\${pad}" y1="16" x2="\${pad}" y2="\${H-pad}"/>\`);
  [10,30,100,300,1000].forEach(t=>{ if(Math.log10(t)<lo||Math.log10(t)>hi)return;
    svg.push(\`<text class="axistext" x="\${sx(t)}" y="\${H-pad+16}" text-anchor="middle">$\${t}</text>\`);
    svg.push(\`<text class="axistext" x="\${pad-8}" y="\${sy(t)+4}" text-anchor="end">$\${t}</text>\`);});
  svg.push(\`<text class="axistext" x="\${(W_+pad)/2}" y="\${H-10}" text-anchor="middle">Model predicted price →</text>\`);
  svg.push(\`<text class="axistext" transform="translate(16 \${(H-pad)/2}) rotate(-90)" text-anchor="middle">Market price →</text>\`);
  // dots
  priced.forEach(c=>{
    const col=c.verdict==='OVERVALUED'?'var(--over)':c.verdict==='UNDERVALUED'?'var(--under)':'var(--fair)';
    const r=6+Math.min(6,Math.abs(c.valuationGap)*10);
    svg.push(\`<circle class="dot" cx="\${sx(c.predictedPrice)}" cy="\${sy(c.marketPrice)}" r="\${r}" fill="\${col}" fill-opacity="0.8" stroke="\${col}" data-i="\${res.indexOf(c)}"/>\`);
  });
  $('chart').innerHTML=svg.join('');
  // tooltips
  const tip=$('tip');
  $('chart').querySelectorAll('.dot').forEach(d=>{
    d.addEventListener('mousemove',e=>{const c=res[+d.dataset.i];
      tip.innerHTML=\`<div class="t">\${c.name}</div><div class="r"><span>\${c.set}</span></div>
        <div class="r">Market <b>\${money(c.marketPrice)}</b></div>
        <div class="r">Model <b>\${money(c.predictedPrice)}</b></div>
        <div class="r">Gap <b style="color:\${c.verdict==='OVERVALUED'?'var(--over)':c.verdict==='UNDERVALUED'?'var(--under)':'var(--fair)'}">\${pct(c.valuationGap)}</b></div>
        <div class="r">Pull / Desir <b>\${c.pullCostScore.toFixed(1)} / \${c.desirabilityScore.toFixed(1)}</b></div>\`;
      tip.style.opacity=1;tip.style.left=Math.min(e.clientX+14,innerWidth-270)+'px';tip.style.top=(e.clientY+14)+'px';});
    d.addEventListener('mouseleave',()=>tip.style.opacity=0);
  });
}

function renderTable(res){
  const rows=[...res].sort((a,b)=>{
    let x=a[sortK],y=b[sortK];
    if(typeof x==='string')return sortDir*x.localeCompare(y);
    return sortDir*((x??-1e9)-(y??-1e9));});
  $('tbl').querySelector('tbody').innerHTML=rows.map(c=>\`<tr>
    <td>\${c.name}</td><td style="color:var(--muted)">\${c.set}</td>
    <td class="num">\${c.pullCostScore.toFixed(1)}</td>
    <td class="num">\${c.desirabilityScore.toFixed(1)}</td>
    <td class="num">\${money(c.marketPrice)}</td>
    <td class="num">\${money(c.predictedPrice)}</td>
    <td class="num" style="color:\${c.verdict==='OVERVALUED'?'var(--over)':c.verdict==='UNDERVALUED'?'var(--under)':'var(--muted)'}">\${pct(c.valuationGap)}</td>
    <td><span class="pill \${c.verdict}">\${c.verdict}</span></td></tr>\`).join('');
}

function renderControls(){
  $('wc').value=W.c;$('wa').value=W.a;$('wt').value=W.t;$('fb').value=BAND;
  const tot=W.c+W.a+W.t;
  $('wcv').textContent=Math.round(W.c/tot*100)+'%';
  $('wav').textContent=Math.round(W.a/tot*100)+'%';
  $('wtv').textContent=Math.round(W.t/tot*100)+'%';
  $('fbv').textContent=BAND;$('bandlbl').textContent=BAND;
}

function draw(){const{m,res}=compute();renderStats(m,res);renderChart(res);renderTable(res);renderControls();}

['wc','wa','wt'].forEach(id=>$(id).addEventListener('input',e=>{
  W[{wc:'c',wa:'a',wt:'t'}[id]]=+e.target.value;draw();}));
$('fb').addEventListener('input',e=>{BAND=+e.target.value;draw();});
$('reset').addEventListener('click',()=>{W={c:45,a:45,t:10};BAND=15;draw();});
$('tbl').querySelectorAll('th').forEach(th=>th.addEventListener('click',()=>{
  const k=th.dataset.k; if(sortK===k)sortDir*=-1;else{sortK=k;sortDir=-1;} draw();}));

draw();
</script>
</body>
</html>
`;

await writeFile(outPath, html);
console.log('Wrote', outPath);
