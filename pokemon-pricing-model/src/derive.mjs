// Turns raw data-source output into the model-input shape used by model.mjs.
// This is where "any card from TCGplayer/pokemontcg.io" becomes a scored card:
//   • marketPrice           ← straight from the source
//   • packsPerRarityHit     ← rarity → pull-rate heuristic (data/pullRates.json)
//   • chaseCardsInTier      ← # cards of the same rarity in the set (from the source)
//   • characterRank         ← curated cross-set premium (data/characterRanks.json)
//   • artworkHype           ← manual override (data/overrides.json) or rarity default
//   • googleTrends          ← override or a neutral default
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

const load = async (f) => JSON.parse(await readFile(join(dataDir, f), 'utf8'));

// Higher-prestige rarities get a higher baseline artwork/hype when unspecified.
const RARITY_ART_DEFAULT = {
  'Special Illustration Rare': 7.5,
  'Illustration Rare': 7,
  'Hyper Rare': 6.5,
  'Rare Rainbow': 6.5,
  'Ultra Rare': 6,
  'Rare Ultra': 6,
  'Double Rare': 5,
  default: 5,
};

function firstWord(s) {
  return (s || '').split(' ')[0];
}

// Resolve a character's premium rank from the curated table (case-insensitive),
// falling back to the configured default.
function resolveRank(pokemon, table) {
  if (!pokemon) return { rank: table.defaultRank, source: 'default' };
  const hit = Object.entries(table.ranks).find(([k]) => k.toLowerCase() === pokemon.toLowerCase());
  return hit ? { rank: hit[1], source: 'table' } : { rank: table.defaultRank, source: 'default' };
}

// Data-driven character premium: estimate a character's rank (1 = most
// desirable) from its own printings, using the median of its top-3 market
// prices as the premium signal. Calibrated against the curated anchors so it is
// consistent with the hand-set ranks: ~$400 top signal → rank ≈ 1.1 (Charizard),
// ~$40 → ≈ 5, ~$5 → ≈ 9. Returns null when there isn't enough price signal.
export function computeCharacterPremium(printings) {
  const prices = (printings || [])
    .map((p) => p.marketPrice)
    .filter((n) => typeof n === 'number' && n > 0)
    .sort((a, b) => b - a);
  if (!prices.length) return null;
  const topN = prices.slice(0, 3);
  const median = topN.sort((a, b) => a - b)[Math.floor((topN.length - 1) / 2)];
  const rank = 11.9 - 4.16 * Math.log10(median); // linear in log-price, from the anchors
  return Math.min(10, Math.max(1, rank));
}

export async function deriveCard(source, query, opts = {}) {
  const [pullRates, charRanks, overrides] = await Promise.all([
    load('pullRates.json'), load('characterRanks.json'), load('overrides.json'),
  ]);

  const raw = await source.fetchCard(query);
  if (!raw) throw new Error(`No card found for ${JSON.stringify(query)} via ${source.name}.`);

  // Supply: packs per rarity hit (heuristic) × chase cards sharing the slot.
  const packsPerRarityHit = pullRates.byRarity[raw.rarity] ?? pullRates.byRarity.default;
  let chaseCardsInTier = 1;
  if (raw.setId != null) {
    const setCards = await source.fetchSetCards(raw.setId);
    chaseCardsInTier = Math.max(1, setCards.filter((c) => c.rarity === raw.rarity).length);
  }

  // Demand: character premium. Priority: per-card override > curated table >
  // computed-from-printings. With opts.autoRank, computing takes precedence over
  // the table (the table still serves as the fallback when printings are thin).
  const pokemon = raw.pokemon || firstWord(raw.name);
  const ov = overrides.byId?.[raw.sourceId] ?? {};
  const tableRank = resolveRank(pokemon, charRanks);
  let characterRank = tableRank.rank;
  let rankSource = tableRank.source;
  if (ov.characterRank != null) {
    characterRank = ov.characterRank;
    rankSource = 'override';
  } else if (opts.autoRank || tableRank.source === 'default') {
    const computed = computeCharacterPremium(await source.fetchPrintings(pokemon));
    if (computed != null) {
      characterRank = computed;
      rankSource = 'computed';
    }
  }

  const artworkHype = ov.artworkHype ?? RARITY_ART_DEFAULT[raw.rarity] ?? RARITY_ART_DEFAULT.default;
  const googleTrends = ov.googleTrends ?? 5;

  return {
    id: raw.sourceId,
    name: raw.name,
    set: raw.set,
    number: raw.number,
    rarity: raw.rarity,
    imageUrl: raw.imageUrl,
    marketPrice: raw.marketPrice,
    packsPerRarityHit,
    chaseCardsInTier,
    packPrice: pullRates.packPriceUSD ?? 4.5,
    characterRank,
    artworkHype,
    googleTrends,
    _provenance: { source: source.name, sourceId: raw.sourceId, pokemon, rankSource },
  };
}

// Convenience: load one of the built-in adapters by name.
export async function loadSource(sourceName) {
  const mod = await import(`./sources/${sourceName}.mjs`);
  return mod;
}
