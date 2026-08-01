// Data source: pokemontcg.io (https://pokemontcg.io) — free, covers ANY card,
// and returns rarity, set composition, images, and embedded TCGplayer +
// Cardmarket prices. An API key (env POKEMONTCG_API_KEY) raises rate limits but
// is optional. This is the recommended "any card" source.
//
// Common source interface (shared by every adapter):
//   fetchCard({name, set, number})  -> raw card | null
//   fetchSetCards(setId)            -> [{ rarity }]        (to count chase cards in a tier)
//   fetchPrintings(pokemonName)     -> [{ name, rarity, marketPrice }]  (for character premium)
//   toRawCard(apiCard)              -> normalized raw card shape used by derive.mjs

const BASE = 'https://api.pokemontcg.io/v2';

export const name = 'pokemontcg';

function headers() {
  const key = process.env.POKEMONTCG_API_KEY;
  return key ? { 'X-Api-Key': key } : {};
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`pokemontcg.io ${res.status} for ${path}`);
  return res.json();
}

// Pick the most representative TCGplayer market price across finishes.
export function marketPriceOf(apiCard) {
  const tp = apiCard.tcgplayer?.prices;
  if (tp) {
    const prefer = ['holofoil', 'normal', 'reverseHolofoil', 'firstEditionHolofoil', 'unlimitedHolofoil'];
    for (const k of prefer) {
      const m = tp[k]?.market ?? tp[k]?.mid;
      if (m != null) return m;
    }
    // fall back to any finish present
    for (const v of Object.values(tp)) {
      const m = v?.market ?? v?.mid;
      if (m != null) return m;
    }
  }
  // Cardmarket (EUR) as a last resort — treat as approximate USD.
  const cm = apiCard.cardmarket?.prices;
  if (cm?.averageSellPrice != null) return cm.averageSellPrice;
  return 0;
}

// Normalize an API card to the shape derive.mjs expects.
export function toRawCard(apiCard) {
  return {
    sourceId: apiCard.id,                 // e.g. "sv3-223"
    name: apiCard.name,                   // e.g. "Charizard ex"
    pokemon: (apiCard.name || '').split(' ')[0], // crude base-species guess
    set: apiCard.set?.name,
    setId: apiCard.set?.id,
    number: apiCard.number,
    rarity: apiCard.rarity || 'default',
    marketPrice: marketPriceOf(apiCard),
    imageUrl: apiCard.images?.small,
  };
}

export async function fetchCard({ name: cardName, set, number }) {
  const q = [`name:"${cardName}"`];
  if (set) q.push(`set.name:"${set}"`);
  if (number) q.push(`number:${number}`);
  const data = await get(`/cards?q=${encodeURIComponent(q.join(' '))}&pageSize=20&orderBy=-set.releaseDate`);
  const cards = data.data ?? [];
  if (!cards.length) return null;
  // Prefer the highest-priced match (usually the chase/SIR printing).
  cards.sort((a, b) => marketPriceOf(b) - marketPriceOf(a));
  return toRawCard(cards[0]);
}

export async function fetchSetCards(setId) {
  const out = [];
  let page = 1;
  for (;;) {
    const data = await get(`/cards?q=set.id:${setId}&pageSize=250&page=${page}&select=id,rarity`);
    const cards = data.data ?? [];
    out.push(...cards.map((c) => ({ rarity: c.rarity || 'default' })));
    if (cards.length < 250) break;
    page += 1;
  }
  return out;
}

export async function fetchPrintings(pokemonName) {
  const data = await get(`/cards?q=name:"${pokemonName}"&pageSize=250&select=id,name,rarity,tcgplayer`);
  return (data.data ?? []).map((c) => ({
    name: c.name, rarity: c.rarity, marketPrice: marketPriceOf(c),
  }));
}
