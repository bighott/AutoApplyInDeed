// pokemon-pricing-model — core engine
//
// Reproduces the two-factor log-linear pricing model described in the source
// video: a card's market price is driven by SUPPLY ("pull cost") and DEMAND
// ("desirability index"). We score every card on both axes, fit an OLS
// regression of ln(price) on those two scores, then flag cards whose market
// price sits well above (overvalued) or below (undervalued) the model line.
//
// Pure functions only — no I/O, no external deps — so the whole thing is unit
// testable and runs anywhere Node does.

export const DEFAULT_WEIGHTS = Object.freeze({
  character: 0.45, // character premium
  artwork: 0.45,   // artwork / hype
  trends: 0.10,    // universal appeal (Google Trends)
});

// Anything within this fraction of the predicted price is "fairly" valued.
export const FAIR_BAND = 0.15;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// ---------------------------------------------------------------------------
// Demand side — Desirability Index (1..10)
// ---------------------------------------------------------------------------

// Character premium: a character's average printing rank (1 = most desirable,
// e.g. Charizard ≈ 1.1) mapped to a 1..10 score. Reciprocal so rank 1 → ~10
// and the score decays smoothly as the character gets less iconic.
export function characterScore(characterRank) {
  return clamp(10 / Math.max(characterRank, 1e-9), 1, 10);
}

// Weighted blend of the three demand components, each on a 1..10 scale.
export function desirabilityIndex(card, weights = DEFAULT_WEIGHTS) {
  const charS = characterScore(card.characterRank);
  const art = clamp(card.artworkHype, 1, 10);
  const trend = clamp(card.googleTrends, 1, 10);
  return weights.character * charS + weights.artwork * art + weights.trends * trend;
}

// ---------------------------------------------------------------------------
// Supply side — Pull Cost
// ---------------------------------------------------------------------------

// Expected number of packs you must open to pull THIS specific card:
// (packs per rarity-slot hit) × (number of chase cards sharing that slot).
// This is the key insight from the video — a "generous" 1-in-45 slot is brutal
// when many chase cards compete for it.
export function expectedPacks(card) {
  return card.packsPerRarityHit * card.chaseCardsInTier;
}

// Same thing in dollars, using the pack's street price.
export function pullDollarCost(card, defaultPackPrice = 4.5) {
  return expectedPacks(card) * (card.packPrice ?? defaultPackPrice);
}

// Pull cost spans orders of magnitude, so we normalize on a log scale to a
// dataset-relative 1..10 score (matching how the video presents it).
export function logNormalizeTo10(values) {
  const logs = values.map((v) => Math.log(Math.max(v, 1e-9)));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const span = max - min || 1;
  return logs.map((l) => 1 + 9 * ((l - min) / span));
}

// ---------------------------------------------------------------------------
// Scoring — enrich raw cards with all derived fields
// ---------------------------------------------------------------------------

export function scoreDataset(cards, weights = DEFAULT_WEIGHTS) {
  const packs = cards.map(expectedPacks);
  const pullScores = logNormalizeTo10(packs);
  return cards.map((c, i) => ({
    ...c,
    expectedPacks: packs[i],
    pullDollarCost: pullDollarCost(c),
    pullCostScore: pullScores[i],
    characterScore: characterScore(c.characterRank),
    desirabilityScore: desirabilityIndex(c, weights),
  }));
}

// ---------------------------------------------------------------------------
// Regression — OLS via normal equations (X'X)β = X'y, 3×3 closed form
// ---------------------------------------------------------------------------

function matMulT(X) {
  // returns X'X for an n×3 X
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const row of X) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  return A;
}

function matVecT(X, y) {
  // returns X'y
  const b = [0, 0, 0];
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < 3; i++) b[i] += X[r][i] * y[r];
  }
  return b;
}

function invert3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Singular design matrix — need more varied data.');
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  return [
    [A / det, D / det, G / det],
    [B / det, E / det, H / det],
    [C / det, F / det, I / det],
  ];
}

function olsSolve(X, y) {
  const XtX = matMulT(X);
  const Xty = matVecT(X, y);
  const inv = invert3(XtX);
  return inv.map((row) => dot(row, Xty));
}

function rSquared(y, yhat) {
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < y.length; i++) {
    ssRes += (y[i] - yhat[i]) ** 2;
    ssTot += (y[i] - mean) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

// Fit ln(price) = β0 + β1·pullCostScore + β2·desirabilityScore
export function fitModel(scored) {
  const rows = scored.filter((c) => c.marketPrice > 0);
  if (rows.length < 4) throw new Error('Need at least 4 priced cards to fit.');
  const X = rows.map((c) => [1, c.pullCostScore, c.desirabilityScore]);
  const y = rows.map((c) => Math.log(c.marketPrice));
  const beta = olsSolve(X, y);
  const yhat = X.map((x) => dot(x, beta));
  return {
    intercept: beta[0],
    pullCoef: beta[1],
    desirCoef: beta[2],
    // Interpretable form: % price change per +1 score point (video's framing).
    pullPctPerPoint: Math.exp(beta[1]) - 1,
    desirPctPerPoint: Math.exp(beta[2]) - 1,
    r2: rSquared(y, yhat),
    n: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Prediction & valuation
// ---------------------------------------------------------------------------

export function predictPrice(model, card) {
  const ln =
    model.intercept +
    model.pullCoef * card.pullCostScore +
    model.desirCoef * card.desirabilityScore;
  return Math.exp(ln);
}

// Attach predicted price, valuation gap (+ = overvalued), and a verdict.
export function valuation(model, scored, fairBand = FAIR_BAND) {
  return scored
    .map((c) => {
      const predictedPrice = predictPrice(model, c);
      const valuationGap = c.marketPrice > 0
        ? (c.marketPrice - predictedPrice) / predictedPrice
        : null;
      const verdict =
        valuationGap == null ? 'UNPRICED'
          : valuationGap > fairBand ? 'OVERVALUED'
          : valuationGap < -fairBand ? 'UNDERVALUED'
          : 'FAIR';
      return { ...c, predictedPrice, valuationGap, verdict };
    })
    .sort((a, b) => (b.valuationGap ?? -Infinity) - (a.valuationGap ?? -Infinity));
}

// One-call convenience: raw cards → fully analyzed + model summary.
export function analyze(cards, weights = DEFAULT_WEIGHTS) {
  const scored = scoreDataset(cards, weights);
  const model = fitModel(scored);
  const results = valuation(model, scored);
  return { model, results };
}
