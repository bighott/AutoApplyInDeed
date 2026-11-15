import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fixture from '../src/sources/fixture.mjs';
import { marketPriceOf, toRawCard } from '../src/sources/pokemontcg.mjs';
import { deriveCard, computeCharacterPremium } from '../src/derive.mjs';

test('pokemontcg parser: picks a market price and normalizes shape', () => {
  const api = {
    id: 'sv3-223', name: 'Charizard ex', number: '223', rarity: 'Special Illustration Rare',
    set: { id: 'sv3', name: 'Obsidian Flames' },
    tcgplayer: { prices: { holofoil: { market: 70 } } },
  };
  assert.equal(marketPriceOf(api), 70);
  const raw = toRawCard(api);
  assert.equal(raw.sourceId, 'sv3-223');
  assert.equal(raw.pokemon, 'Charizard');
  assert.equal(raw.setId, 'sv3');
});

test('fixture source resolves a card and its set/printings', async () => {
  const card = await fixture.fetchCard({ name: 'Mew ex', set: '151' });
  assert.equal(card.sourceId, 'sv3pt5-205');
  assert.equal(card.marketPrice, 327);
  const setCards = await fixture.fetchSetCards('sv3');
  assert.ok(setCards.length >= 4);
  const printings = await fixture.fetchPrintings('Charizard');
  assert.ok(printings.length >= 3); // multiple Charizard printings in the fixture
});

test('deriveCard produces a fully-scored model input from source data', async () => {
  const derived = await deriveCard(fixture, { name: 'Charizard ex', set: 'Obsidian Flames', number: '223' });
  assert.equal(derived.id, 'sv3-223');
  assert.equal(derived.rarity, 'Special Illustration Rare');
  assert.equal(derived.marketPrice, 70);
  // rarity → pull-rate heuristic applied
  assert.equal(derived.packsPerRarityHit, 34);
  // chase cards in tier counted from the set (>=1)
  assert.ok(derived.chaseCardsInTier >= 1);
  // character premium resolved from the curated table (Charizard ≈ 1.1)
  assert.ok(Math.abs(derived.characterRank - 1.1) < 1e-9);
  // artwork override from data/overrides.json applied
  assert.equal(derived.artworkHype, 6);
  assert.equal(derived._provenance.source, 'fixture');
});

test('computeCharacterPremium: pricier printings → lower (better) rank', () => {
  const low = computeCharacterPremium([{ marketPrice: 320 }, { marketPrice: 376 }, { marketPrice: 90 }]);
  const high = computeCharacterPremium([{ marketPrice: 6 }, { marketPrice: 4 }]);
  assert.ok(low >= 1 && low <= 10 && high >= 1 && high <= 10);
  assert.ok(low < high);                 // expensive character ranks better (lower number)
  assert.ok(Math.abs(low - 1.1) < 1.2);  // Charizard-like signal lands near the curated anchor
  assert.equal(computeCharacterPremium([]), null); // no price signal
});

test('deriveCard --auto-rank computes character premium from printings', async () => {
  const d = await deriveCard(fixture, { name: 'Charizard ex', set: 'Obsidian Flames', number: '223' }, { autoRank: true });
  assert.equal(d._provenance.rankSource, 'computed');
  // computed rank for Charizard should land in a plausible top-tier range
  assert.ok(d.characterRank >= 1 && d.characterRank <= 3, `rank ${d.characterRank}`);
});
