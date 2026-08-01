import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  characterScore, desirabilityIndex, expectedPacks, logNormalizeTo10,
  scoreDataset, fitModel, predictPrice, valuation, analyze, DEFAULT_WEIGHTS,
} from '../src/model.mjs';
import { loadCards } from '../src/report.mjs';

test('characterScore: rank 1 → ~10, decays with rank, clamps to [1,10]', () => {
  assert.ok(Math.abs(characterScore(1) - 10) < 1e-9);
  assert.ok(characterScore(1.1) > characterScore(2.3)); // Charizard beats Dragonite
  assert.equal(characterScore(0.5), 10); // clamped high
  assert.equal(characterScore(20), 1);   // clamped low
});

test('desirabilityIndex: weighted blend, all-10 card scores 10', () => {
  const perfect = { characterRank: 1, artworkHype: 10, googleTrends: 10 };
  assert.ok(Math.abs(desirabilityIndex(perfect) - 10) < 1e-9);
  // weights sum to 1
  const w = DEFAULT_WEIGHTS;
  assert.ok(Math.abs(w.character + w.artwork + w.trends - 1) < 1e-9);
});

test('expectedPacks multiplies slot odds by chase-card count', () => {
  assert.equal(expectedPacks({ packsPerRarityHit: 45, chaseCardsInTier: 9 }), 405);
});

test('logNormalizeTo10 maps min→1 and max→10', () => {
  const out = logNormalizeTo10([10, 100, 1000]);
  assert.ok(Math.abs(out[0] - 1) < 1e-9);
  assert.ok(Math.abs(out[2] - 10) < 1e-9);
  assert.ok(out[1] > out[0] && out[1] < out[2]);
});

test('fitModel recovers a known log-linear relationship', () => {
  // Build synthetic cards whose ln(price) = 1 + 0.2*pull + 0.4*desir exactly.
  const cards = [];
  for (let p = 15; p <= 60; p += 5) {
    for (const packs of [20, 200]) {
      cards.push({
        id: `${p}-${packs}`, packsPerRarityHit: packs, chaseCardsInTier: 1,
        characterRank: 11 - p / 6, artworkHype: p % 10 || 1, googleTrends: 5,
        marketPrice: 1, // placeholder, set below
      });
    }
  }
  const scored = scoreDataset(cards);
  for (const c of scored) c.marketPrice = Math.exp(1 + 0.2 * c.pullCostScore + 0.4 * c.desirabilityScore);
  const m = fitModel(scored);
  assert.ok(Math.abs(m.intercept - 1) < 1e-6);
  assert.ok(Math.abs(m.pullCoef - 0.2) < 1e-6);
  assert.ok(Math.abs(m.desirCoef - 0.4) < 1e-6);
  assert.ok(m.r2 > 0.999);
});

test('predictPrice is consistent with the fitted coefficients', () => {
  const m = { intercept: 2, pullCoef: 0.18, desirCoef: 0.33 };
  const card = { pullCostScore: 5, desirabilityScore: 7 };
  assert.ok(Math.abs(predictPrice(m, card) - Math.exp(2 + 0.18 * 5 + 0.33 * 7)) < 1e-9);
});

test('valuation flags over/under/fair relative to the band', () => {
  const m = { intercept: 0, pullCoef: 0, desirCoef: 0 }; // predicts exp(0)=1 for all
  const scored = [
    { id: 'over', pullCostScore: 1, desirabilityScore: 1, marketPrice: 2 },
    { id: 'fair', pullCostScore: 1, desirabilityScore: 1, marketPrice: 1.05 },
    { id: 'under', pullCostScore: 1, desirabilityScore: 1, marketPrice: 0.5 },
  ];
  const res = valuation(m, scored, 0.15);
  const by = Object.fromEntries(res.map((c) => [c.id, c.verdict]));
  assert.equal(by.over, 'OVERVALUED');
  assert.equal(by.fair, 'FAIR');
  assert.equal(by.under, 'UNDERVALUED');
  // sorted most-overvalued first
  assert.equal(res[0].id, 'over');
});

test('end-to-end on seed data reproduces the video narrative', async () => {
  const cards = await loadCards();
  const { model, results } = analyze(cards);
  // Coefficients land near the video's 19% / 41%.
  assert.ok(model.pullPctPerPoint > 0.12 && model.pullPctPerPoint < 0.28, `pull ${model.pullPctPerPoint}`);
  assert.ok(model.desirPctPerPoint > 0.30 && model.desirPctPerPoint < 0.50, `desir ${model.desirPctPerPoint}`);
  assert.ok(model.r2 > 0.85, `r2 ${model.r2}`);
  const v = Object.fromEntries(results.map((c) => [c.id, c.verdict]));
  assert.equal(v['phantasmal-mega-charizard-x'], 'OVERVALUED');
  assert.equal(v['obf-charizard-223'], 'UNDERVALUED');
  assert.equal(v['151-charizard'], 'UNDERVALUED');
});
