// Data source: official TCGplayer API (https://docs.tcgplayer.com).
//
// The TCGplayer API is partner-gated: you need an approved client_id +
// client_secret to mint a bearer token. Set them via env:
//   TCGPLAYER_CLIENT_ID, TCGPLAYER_CLIENT_SECRET
// Category id 3 = Pokémon. This adapter implements the token flow, product
// search, and price lookup; without credentials it throws a clear error so the
// caller can fall back to the pokemontcg source (which also carries TCGplayer
// prices) or the offline fixture.
//
// Implements the same interface as sources/pokemontcg.mjs.

const AUTH = 'https://api.tcgplayer.com/token';
const BASE = 'https://api.tcgplayer.com';
const POKEMON_CATEGORY = 3;

export const name = 'tcgplayer';

let cachedToken = null;

async function token() {
  if (cachedToken) return cachedToken;
  const id = process.env.TCGPLAYER_CLIENT_ID;
  const secret = process.env.TCGPLAYER_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'TCGplayer API needs TCGPLAYER_CLIENT_ID and TCGPLAYER_CLIENT_SECRET ' +
      '(partner access). Use --source pokemontcg (also carries TCGplayer prices) ' +
      'or --source fixture instead.',
    );
  }
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
  const res = await fetch(AUTH, { method: 'POST', body });
  if (!res.ok) throw new Error(`TCGplayer token ${res.status}`);
  cachedToken = (await res.json()).access_token;
  return cachedToken;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`TCGplayer ${res.status} for ${path}`);
  return (await res.json()).results ?? [];
}

async function marketPriceForProduct(productId) {
  const prices = await get(`/pricing/product/${productId}`);
  const prefer = ['Holofoil', 'Normal', 'Reverse Holofoil', '1st Edition Holofoil'];
  for (const p of prefer) {
    const hit = prices.find((x) => x.subTypeName === p && x.marketPrice != null);
    if (hit) return hit.marketPrice;
  }
  const any = prices.find((x) => x.marketPrice != null);
  return any?.marketPrice ?? 0;
}

export async function fetchCard({ name: cardName, set, number }) {
  const search = await get(
    `/catalog/products?categoryId=${POKEMON_CATEGORY}` +
    `&productName=${encodeURIComponent(cardName)}&getExtendedFields=true&limit=25`,
  );
  let matches = search;
  if (set) matches = matches.filter((p) => (p.groupName || '').toLowerCase().includes(set.toLowerCase()));
  if (number) matches = matches.filter((p) => (p.extendedData || []).some((e) => e.name === 'Number' && String(e.value).includes(String(number))));
  if (!matches.length) matches = search;
  if (!matches.length) return null;
  const withPrices = await Promise.all(matches.slice(0, 10).map(async (p) => ({ p, price: await marketPriceForProduct(p.productId) })));
  withPrices.sort((a, b) => b.price - a.price);
  const { p, price } = withPrices[0];
  const rarity = (p.extendedData || []).find((e) => e.name === 'Rarity')?.value || 'default';
  const num = (p.extendedData || []).find((e) => e.name === 'Number')?.value || number;
  return {
    sourceId: `tcg-${p.productId}`,
    name: p.name,
    pokemon: (p.cleanName || p.name || '').split(' ')[0],
    set: p.groupName,
    setId: p.groupId,
    number: num,
    rarity,
    marketPrice: price,
    imageUrl: p.imageUrl,
  };
}

export async function fetchSetCards(groupId) {
  const products = await get(`/catalog/products?categoryId=${POKEMON_CATEGORY}&groupId=${groupId}&getExtendedFields=true&limit=500`);
  return products.map((p) => ({ rarity: (p.extendedData || []).find((e) => e.name === 'Rarity')?.value || 'default' }));
}

export async function fetchPrintings(pokemonName) {
  const products = await get(`/catalog/products?categoryId=${POKEMON_CATEGORY}&productName=${encodeURIComponent(pokemonName)}&getExtendedFields=true&limit=200`);
  return Promise.all(products.slice(0, 40).map(async (p) => ({
    name: p.name,
    rarity: (p.extendedData || []).find((e) => e.name === 'Rarity')?.value || 'default',
    marketPrice: await marketPriceForProduct(p.productId),
  })));
}
