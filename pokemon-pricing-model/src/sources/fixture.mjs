// Offline data source: reads data/fixtures/pokemontcg.json (pokemontcg.io API
// shape) so the full ingestion pipeline runs with no network. Reuses the real
// pokemontcg parser, so exercising this adapter also exercises that code path.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toRawCard, marketPriceOf } from './pokemontcg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', '..', 'data', 'fixtures', 'pokemontcg.json');

export const name = 'fixture';

let poolPromise;
async function pool() {
  poolPromise ??= readFile(fixturePath, 'utf8').then((s) => JSON.parse(s).cards ?? []);
  return poolPromise;
}

export async function fetchCard({ name: cardName, set, number }) {
  const cards = await pool();
  let matches = cards.filter((c) => c.name.toLowerCase() === cardName.toLowerCase());
  if (set) matches = matches.filter((c) => (c.set?.name || '').toLowerCase().includes(set.toLowerCase()));
  if (number) matches = matches.filter((c) => String(c.number) === String(number));
  if (!matches.length) return null;
  matches.sort((a, b) => marketPriceOf(b) - marketPriceOf(a));
  return toRawCard(matches[0]);
}

export async function fetchSetCards(setId) {
  const cards = await pool();
  return cards.filter((c) => c.set?.id === setId).map((c) => ({ rarity: c.rarity || 'default' }));
}

export async function fetchPrintings(pokemonName) {
  const cards = await pool();
  return cards
    .filter((c) => c.name.toLowerCase().startsWith(pokemonName.toLowerCase()))
    .map((c) => ({ name: c.name, rarity: c.rarity, marketPrice: marketPriceOf(c) }));
}
