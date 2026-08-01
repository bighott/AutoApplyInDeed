// CLI: price ANY card using live (or offline) market data.
//
//   node src/ingest.mjs "Charizard ex" --set "Obsidian Flames" [--number 223]
//                                       [--source pokemontcg|tcgplayer|fixture]
//                                       [--add]   # append to data/cards.json
//
// It fetches the card from the chosen source, derives the model inputs, fits the
// model on the seed dataset PLUS this card, and prints the valuation verdict.
// Defaults to --source pokemontcg (free, needs outbound HTTPS). Use --source
// fixture for a fully offline demo.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze } from './model.mjs';
import { deriveCard, loadSource } from './derive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cardsPath = join(here, '..', 'data', 'cards.json');

function parseArgs(argv) {
  const out = { _: [], source: 'pokemontcg' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--add') out.add = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(0) + '%';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cardName = args._.join(' ').trim();
  if (!cardName) {
    console.error('Usage: node src/ingest.mjs "<card name>" [--set S] [--number N] [--source pokemontcg|tcgplayer|fixture] [--add]');
    process.exit(1);
  }

  const source = await loadSource(args.source);
  console.log(`\nFetching "${cardName}"${args.set ? ` (${args.set})` : ''} via ${source.name}…`);

  let derived;
  try {
    derived = await deriveCard(source, { name: cardName, set: args.set, number: args.number });
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    if (/CONNECT|fetch failed|ENOTFOUND|403|EAI_AGAIN/i.test(String(err))) {
      console.error('  (Network egress may be blocked here — try `--source fixture` for an offline demo.)');
    }
    process.exit(2);
  }

  console.log('\nDerived model inputs:');
  console.table({
    rarity: derived.rarity,
    marketPrice: money(derived.marketPrice),
    packsPerRarityHit: derived.packsPerRarityHit,
    chaseCardsInTier: derived.chaseCardsInTier,
    characterRank: derived.characterRank,
    artworkHype: derived.artworkHype,
    googleTrends: derived.googleTrends,
  });

  // Fit on the seed dataset + this card, then read back this card's verdict.
  const seed = (JSON.parse(await readFile(cardsPath, 'utf8')).cards) ?? [];
  const withNew = [...seed.filter((c) => c.id !== derived.id), derived];
  const { model, results } = analyze(withNew);
  const me = results.find((c) => c.id === derived.id);

  console.log(`\nModel:   R²=${model.r2.toFixed(2)}  |  +1 pull → ${pct(model.pullPctPerPoint)}  |  +1 desir → ${pct(model.desirPctPerPoint)}`);
  console.log(`\n${derived.name} — ${derived.set}`);
  console.log(`  Pull cost score : ${me.pullCostScore.toFixed(1)}`);
  console.log(`  Desirability    : ${me.desirabilityScore.toFixed(1)}`);
  console.log(`  Market price    : ${money(me.marketPrice)}`);
  console.log(`  Model price     : ${money(me.predictedPrice)}`);
  console.log(`  Gap             : ${pct(me.valuationGap)}  →  ${me.verdict}\n`);

  if (args.add) {
    const raw = JSON.parse(await readFile(cardsPath, 'utf8'));
    raw.cards = withNew.map(({ predictedPrice, valuationGap, verdict, pullCostScore,
      desirabilityScore, characterScore, expectedPacks, pullDollarCost, ...keep }) => keep);
    await writeFile(cardsPath, JSON.stringify(raw, null, 2) + '\n');
    console.log(`✓ Added "${derived.name}" to data/cards.json (${raw.cards.length} cards). Re-run \`npm run dashboard\` to refresh.\n`);
  }
}

main();
