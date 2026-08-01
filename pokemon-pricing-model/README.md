# Pokémon Chase-Card Pricing Model

A reproduction of the two-factor pricing model from the source video: predict a
modern Pokémon chase card's market price from **supply** and **demand**, then
flag cards trading well above (overvalued) or below (undervalued) the model.

It works two ways:

1. **Seed dataset** — the cards discussed in the video, ready to run.
2. **Any card** — pull live market data from **TCGplayer** or **pokemontcg.io**
   (or an offline fixture), derive the model inputs, and score it.

```
npm run report      # fit + valuation table on the seed dataset
npm run dashboard   # build public/dashboard.html (interactive, re-fits live)
npm run demo        # price a card from offline data (no network needed)
npm test            # unit tests
```

## How the model works

### Supply — "pull cost"
How many packs must you open to pull *this specific* card?

```
expected packs = (packs per rarity-slot hit) × (chase cards sharing that slot)
```

The key insight from the video: a "generous" 1-in-45 slot is brutal when many
chase cards compete for it (Prismatic Evolutions). Normalized on a log scale to
a **1–10 pull-cost score**.

### Demand — "desirability index" (1–10)
A weighted blend (video defaults):

| Component | Weight | Source |
|---|---|---|
| Character premium | 45% | avg printing rank of the character (Charizard ≈ 1.1) |
| Artwork / hype | 45% | subjective 1–10 (Bubble Mew = 10, bread-dog "Dot's Bun" = 1) |
| Universal appeal | 10% | Google Trends search interest |

### The regression
```
ln(price) = β₀ + β₁·pullCostScore + β₂·desirabilityScore
```
Fit by ordinary least squares. On the seed data it recovers the video's
findings: **≈ +20% price per pull-cost point, ≈ +39% per desirability point**
(the video reported 19% / 41% — demand ≈ 2× supply), with **R² ≈ 0.92**.

**Valuation** = market price vs. model prediction. Beyond ±15% → OVER / UNDER.
Reproduces the video's calls: Mega Charizard X **overvalued (+89%)**, Obsidian
Flames & 151 Charizards **undervalued**, Gardevoir **fair**.

## Pricing any card (live data)

```
node src/ingest.mjs "Charizard ex" --set "Obsidian Flames" --number 223 \
     --source pokemontcg          # free API, covers any card, optional key
```

Sources (`--source`):

| Source | Notes |
|---|---|
| `pokemontcg` *(default)* | [pokemontcg.io](https://pokemontcg.io) — free, any card, carries TCGplayer + Cardmarket prices. Optional `POKEMONTCG_API_KEY` for higher limits. |
| `tcgplayer` | Official [TCGplayer API](https://docs.tcgplayer.com). Needs `TCGPLAYER_CLIENT_ID` / `TCGPLAYER_CLIENT_SECRET` (partner access). |
| `fixture` | Offline sample data — no network. Used by `npm run demo` and the tests. |

What the pipeline derives from a raw card (`src/derive.mjs`):

- **marketPrice** — straight from the source.
- **packsPerRarityHit** — rarity → pull-rate heuristic (`data/pullRates.json`);
  no public API exposes real pull rates, so these are editable estimates.
- **chaseCardsInTier** — counted live from the set's rarity composition.
- **characterRank** — curated cross-set premium (`data/characterRanks.json`),
  with a default for unlisted Pokémon.
- **artworkHype** — subjective, so it can't be scraped: set it per card in
  `data/overrides.json`, else a rarity-based default is used.
- **googleTrends** — override or a neutral default.

`--add` appends the fetched card to `data/cards.json` so it joins the fit and the
dashboard.

> **Note on this environment:** the sandbox's network policy currently blocks
> outbound calls to card-data hosts (`api.pokemontcg.io` returned a proxy 403),
> so `--source pokemontcg`/`tcgplayer` can't reach the network *here*. They work
> unchanged where outbound HTTPS to those hosts is allowed (your machine, or a
> web-session environment with a permissive network policy). Use
> `--source fixture` for a fully offline demo.

## Dashboard

`npm run dashboard` writes a self-contained `public/dashboard.html`:

- Log–log scatter of market vs. model price with a fair-value line and ±band.
- Hover any card for its inputs and valuation gap.
- **Live weight sliders** — the OLS regression re-fits in the browser as you
  reweight character / artwork / trends, so you can test the model's sensitivity.
- Sortable card ledger.

## Data honesty

The seed prices and pull-rate inputs are **illustrative** — hand-built to
reconstruct and reproduce the video's narrative, not scraped live. The model
*math* is the deliverable; point it at real data (via `src/ingest.mjs`) for real
analysis. Every derived input is transparent and overridable in `data/`.

## Layout

```
src/model.mjs           pure engine — scoring, OLS fit, prediction, valuation
src/report.mjs          CLI report on the seed dataset
src/buildDashboard.mjs  generates the interactive dashboard
src/derive.mjs          raw source data → model inputs
src/ingest.mjs          CLI: price any card from a source
src/sources/            pokemontcg · tcgplayer · fixture adapters
data/                   cards, pull-rate & character tables, overrides, fixtures
test/                   node:test unit suite
```
