// CLI report: fit the model on data/cards.json and print predicted vs market
// price with over/under-valued flags. Run:  node src/report.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze } from './model.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadCards(path = join(here, '..', 'data', 'cards.json')) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return raw.cards ?? raw;
}

const money = (n) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(0) + '%';
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const padL = (s, n) => String(s).padStart(n);

function main(results, model) {
  console.log('\n=== Pokémon Chase-Card Pricing Model ===\n');
  console.log(`Model:  ln(price) = ${model.intercept.toFixed(3)} `
    + `+ ${model.pullCoef.toFixed(3)}·pullCost + ${model.desirCoef.toFixed(3)}·desirability`);
  console.log(`Fit:    R² = ${model.r2.toFixed(3)}  (n = ${model.n})`);
  console.log(`Effect: +1 pull-cost point → ${pct(model.pullPctPerPoint)} price   |   `
    + `+1 desirability point → ${pct(model.desirPctPerPoint)} price\n`);

  console.log(pad('Card', 34) + pad('Set', 22)
    + padL('Pull', 6) + padL('Desir', 7)
    + padL('Market', 9) + padL('Model', 9) + padL('Gap', 7) + '  Verdict');
  console.log('-'.repeat(110));
  for (const c of results) {
    console.log(
      pad(c.name, 34) + pad(c.set, 22)
      + padL(c.pullCostScore.toFixed(1), 6)
      + padL(c.desirabilityScore.toFixed(1), 7)
      + padL(money(c.marketPrice), 9)
      + padL(money(c.predictedPrice), 9)
      + padL(c.valuationGap == null ? '—' : pct(c.valuationGap), 7)
      + '  ' + c.verdict,
    );
  }

  const over = results.filter((c) => c.verdict === 'OVERVALUED');
  const under = [...results].reverse().filter((c) => c.verdict === 'UNDERVALUED');
  console.log('\nMost OVERVALUED: ' + (over[0] ? `${over[0].name} (${pct(over[0].valuationGap)})` : 'none'));
  console.log('Most UNDERVALUED: ' + (under[0] ? `${under[0].name} (${pct(under[0].valuationGap)})` : 'none'));
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cards = await loadCards();
  const { model, results } = analyze(cards);
  main(results, model);
}
