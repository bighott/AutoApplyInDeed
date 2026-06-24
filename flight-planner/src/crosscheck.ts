/**
 * Cross-checking flight prices across multiple providers.
 *
 * Two tools:
 *   - CheapestOfProvider: a FlightProvider that queries several sub-providers
 *     for each leg and returns the lowest quote (tagged with its source). Feed
 *     it to planTrip() to plan on the best cross-checked price per leg.
 *   - compareLegPrices / formatComparison: price the same unique legs through
 *     each named provider and report a side-by-side table — e.g. SerpApi
 *     (Google Flights) vs Expedia — with the per-leg cheapest source and spread.
 */

import {
  enumerateItineraries,
  uniqueLegQueries,
  type FlightProvider,
} from './planner';
import type { FlightQuote, LegQuery, SearchOpts, TripSpec } from './types';

export interface NamedProvider {
  name: string;
  provider: FlightProvider;
}

/**
 * Queries every sub-provider for a leg and returns the cheapest quote, recording
 * the winning source in `bookingLabel` (e.g. "cheapest: Expedia"). A failing or
 * empty sub-provider is skipped rather than failing the whole leg.
 */
export class CheapestOfProvider implements FlightProvider {
  constructor(private readonly providers: NamedProvider[]) {
    if (providers.length === 0) {
      throw new Error('CheapestOfProvider: at least one provider is required');
    }
  }

  /** Billed calls = sum of each sub-provider's billable count (free ones report none). */
  countBillable(
    queries: LegQuery[],
    opts: SearchOpts,
  ): number {
    return this.providers.reduce(
      (sum, { provider }) => sum + (provider.countBillable?.(queries, opts) ?? 0),
      0,
    );
  }

  async searchCheapest(
    q: LegQuery,
    opts: SearchOpts,
  ): Promise<FlightQuote | null> {
    const quotes = await Promise.all(
      this.providers.map(async ({ name, provider }) => {
        try {
          const quote = await provider.searchCheapest(q, opts);
          return quote ? { name, quote } : null;
        } catch {
          return null;
        }
      }),
    );
    const found = quotes.filter((x): x is { name: string; quote: FlightQuote } => x !== null);
    if (found.length === 0) return null;
    found.sort((a, b) => a.quote.price - b.quote.price);
    const winner = found[0];
    return {
      ...winner.quote,
      bookingLabel: `cheapest: ${winner.name}`,
    };
  }
}

export interface LegComparison {
  leg: LegQuery;
  /** Quote per provider name (null = that source had no fare). */
  quotes: Record<string, FlightQuote | null>;
  cheapestProvider: string | null;
  cheapestPrice: number | null;
  /** max price − min price among providers that returned a fare. */
  spread: number | null;
}

export interface ComparisonReport {
  rows: LegComparison[];
  providerNames: string[];
  /** Per-provider count of legs where that source was strictly cheapest. */
  winCounts: Record<string, number>;
}

/**
 * Price every unique leg of `spec` through each provider and compare. Reuses the
 * planner's own leg enumeration so the comparison covers exactly the searches a
 * real plan would run.
 */
export async function compareLegPrices(
  spec: TripSpec,
  providers: NamedProvider[],
): Promise<ComparisonReport> {
  const currency = spec.currency || 'USD';
  const opts: SearchOpts = {
    adults: spec.adults,
    cabin: spec.cabin,
    currency,
    excludeAirlines: spec.excludeAirlines,
  };
  const legs = uniqueLegQueries(enumerateItineraries(spec));
  const providerNames = providers.map((p) => p.name);
  const winCounts: Record<string, number> = Object.fromEntries(
    providerNames.map((n) => [n, 0]),
  );

  const rows: LegComparison[] = [];
  for (const leg of legs) {
    const quotes: Record<string, FlightQuote | null> = {};
    await Promise.all(
      providers.map(async ({ name, provider }) => {
        try {
          quotes[name] = await provider.searchCheapest(leg, opts);
        } catch {
          quotes[name] = null;
        }
      }),
    );

    const priced = providerNames
      .map((name) => ({ name, price: quotes[name]?.price }))
      .filter((x): x is { name: string; price: number } => typeof x.price === 'number');

    let cheapestProvider: string | null = null;
    let cheapestPrice: number | null = null;
    let spread: number | null = null;
    if (priced.length > 0) {
      priced.sort((a, b) => a.price - b.price);
      cheapestProvider = priced[0].name;
      cheapestPrice = priced[0].price;
      spread = priced[priced.length - 1].price - priced[0].price;
      winCounts[cheapestProvider] += 1;
    }

    rows.push({ leg, quotes, cheapestProvider, cheapestPrice, spread });
  }

  return { rows, providerNames, winCounts };
}

function money(n: number | null | undefined, currency: string): string {
  return n == null ? '—' : `${currency} ${n.toFixed(2)}`;
}

export function formatComparison(spec: TripSpec, report: ComparisonReport): string {
  const currency = spec.currency || 'USD';
  const lines: string[] = [];
  lines.push('Flight price cross-check (per unique leg):');
  lines.push('');

  for (const row of report.rows) {
    const { origin, destination, date } = row.leg;
    lines.push(`   ${origin}→${destination} ${date}`);
    for (const name of report.providerNames) {
      const q = row.quotes[name];
      const marker = name === row.cheapestProvider ? ' ★' : '';
      const extra = q?.airline ? `  ·  ${q.airline}` : '';
      lines.push(`      ${name.padEnd(10)} ${money(q?.price, currency)}${extra}${marker}`);
    }
    if (row.spread != null && row.spread > 0) {
      lines.push(`      Δ spread: ${money(row.spread, currency)} (cheapest: ${row.cheapestProvider})`);
    }
    lines.push('');
  }

  const wins = report.providerNames
    .map((n) => `${n}: ${report.winCounts[n]}`)
    .join('   ');
  lines.push(`Cheapest-source tally — ${wins}`);
  return lines.join('\n');
}
