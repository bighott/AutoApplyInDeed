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
  if (!pokemon) return table.defaultRank;
  const hit = Object.entries(table.ranks).find(([k]) => k.toLowerCase() === pokemon.toLowerCase());
  return hit ? hit[1] : table.defaultRank;
}

export async function deriveCard(source, query) {
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

  // Demand: character premium (curated), artwork (override/default), trends (override/default).
  const pokemon = raw.pokemon || firstWord(raw.name);
  const ov = overrides.byId?.[raw.sourceId] ?? {};
  const characterRank = ov.characterRank ?? resolveRank(pokemon, charRanks);
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
    _provenance: { source: source.name, sourceId: raw.sourceId, pokemon },
  };
}

// Convenience: load one of the built-in adapters by name.
export async function loadSource(sourceName) {
  const mod = await import(`./sources/${sourceName}.mjs`);
  return mod;
}
