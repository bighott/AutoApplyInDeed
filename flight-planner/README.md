# flight-planner

Multi-city, multi-day **flexible-date** flight price planner. You describe a
trip as an ordered list of stops, each with a **night range** (e.g. "New York
2–3 nights, London 3–4 nights"); the planner expands those ranges into concrete
candidate departure dates, prices every leg/date once, and returns the
**cheapest feasible combination** — i.e. it searches over multiple days for the
best total price.

> **Provider note (read this).** There is **no Google Flights API** — Google
> Flights can only be scraped in a browser. This planner is **provider-agnostic**
> instead: it works with any source that can return the cheapest quote for an
> `(origin, destination, date)` leg. The live demo below uses **Expedia**'s
> flight-search via Claude's MCP tool (agent-driven); your own deployed code
> would plug in a keyed API (Duffel, Amadeus, Kiwi/Tequila, …).

## Web UI

Two tabs:

- **Multi-city Planner** — you give the stops *in order*; it optimizes dates.
- **✦ Plan my trip** — you give an *unordered* set of places, a date window, and a
  total number of nights. The advisor acts as a travel agent: it tries every
  visit **order**, every way to split the nights, every start date in the window,
  and every depart/return origin pairing, then returns the cheapest / fastest /
  best-value **routes** (e.g. "leave Pittsburgh, Paris → Rome → Berlin, fly home
  into Cleveland"). Enter any origins and any places — the pre-filled values are
  just an editable example.


```
npm run ui        # then open http://localhost:8787
```

A zero-dependency local web app to build and test trips interactively:

- **Airport autocomplete** on every origin/stop field (type a city, code, or
  airport name — `lon`, `lhr`, and `heath` all find London Heathrow).
- **Multiple origins** — add several departure airports; the planner tries a
  round trip from each and picks the cheapest.
- **Cheapest / Fastest / Best value** picks side by side (best value balances
  price 60% and total flight time 40%), plus a sortable list of all options.
- **Per-day price matrix** with flight times, cheapest day highlighted.
- **Clickable booking links** per leg.
- **Price source** selectable: Mock (offline, no key), SerpApi (live), or
  Cross-check (SerpApi vs Expedia). The UI warns if no `SERPAPI_KEY` is set.

## How it works

```
TripSpec ─► enumerateItineraries ─► uniqueLegQueries ─► price each (provider)
   │              (night ranges ×          (dedupe)          │
   │               flexible start)                           ▼
   └──────────────────────────────────────────────►  pick cheapest feasible
                                                       combination + matrix
```

- **`TripStop { code, minNights, maxNights }`** — per-location day range.
- **`startFlexDays`** — also sweep N start dates beginning at `startDate`.
- The planner enumerates every (start offset × night-combination) itinerary,
  computes the **unique** set of leg/date searches (so each is priced once),
  prices them with a concurrency limit, then sums and ranks itineraries.
- Output includes the **per-leg price matrix** (what each day costs) and the
  cheapest-first itinerary ranking — not just a single answer.

## Files

```
src/
  types.ts      TripSpec, TripStop, LegQuery, FlightQuote, PlanResult, ...
  planner.ts    enumerate → dedupe → price → optimize (the core)
  provider.ts   FlightProvider interface + Mock / Static / Http providers
  adapters.ts   map Expedia search responses → FlightQuote (cheapestExpediaQuote)
  format.ts     pretty-print a PlanResult (itinerary + matrix + ranking)
  demo.ts       offline demo with deterministic mock data (+ assertions)
  examples/sfo-nyc-london.ts   LIVE Expedia fares, run through the planner
```

## Run it

```bash
npm install
npm run demo          # offline, deterministic mock provider
npm run example:live  # real Expedia fares (captured) run through the planner
npm run typecheck
```

## Live result (real Expedia fares, July 2026, 1 adult, economy)

Trip: **SFO → New York (2–3n) → London (3–4n) → SFO**, fixed start 2026-07-15.
Six unique leg searches priced; planner output:

```
★ CHEAPEST: USD 1377.03  — 3 nights NYC, 3 nights London
   SFO→JFK 2026-07-15  $183.20  American
   JFK→LHR 2026-07-18  $284.50  British Airways
   LHR→SFO 2026-07-21  $909.33  TAP Portugal

Per-leg matrix:
   JFK→LHR  07-17 $314.50   07-18 $284.50
   LHR→SFO  07-20 $1289.63  07-21 $909.33  07-22 $909.33

Ranking: $1377.03 [3,3] · $1377.03 [3,4] · $1407.03 [2,4] · $1787.33 [2,3]
```

**The day-range search saved $410 (23%)** vs. the naive 2-nights-in-NYC plan
($1,787.33) — purely by shifting how many nights to spend in each city so the
expensive LHR→SFO leg lands on a cheaper day.

## The agent-driven Expedia path (how the live numbers were produced)

The Expedia MCP tool is **agent-only** — it can't be called from your own
running code. The bridge is `StaticFlightProvider`:

1. `uniqueLegQueries(enumerateItineraries(spec))` → the exact list of
   `(origin, destination, date)` searches needed.
2. Run each through the Expedia flight-search tool.
3. `cheapestExpediaQuote(response)` (in `adapters.ts`) → a `FlightQuote`.
4. `StaticFlightProvider.fromEntries([...])` → hand the map to `planTrip()`.

For a **self-running** deployment, implement `FlightProvider.searchCheapest()`
against a keyed API (see `HttpFlightProvider` template in `provider.ts`).

## Caveats

- Prices and seat availability change constantly; "sold out at this fare" flags
  mean the cheapest fare bucket is gone — a real booking takes the next bookable
  fare. Re-pull before booking.
- `maxItineraries` (default 1000) guards against combinatorial blow-up; very wide
  night ranges × large `startFlexDays` produce many itineraries and many leg
  searches. Narrow ranges to keep the search bounded.

## License

MIT. Educational; no warranty.
