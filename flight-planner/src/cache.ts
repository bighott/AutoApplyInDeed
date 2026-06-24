/**
 * Fare cache: wraps any FlightProvider with a TTL memo so repeated leg lookups
 * (re-runs, the two tabs sharing legs, overlapping routes in the advisor) don't
 * re-hit a billed API. Fares barely move within an hour, so the TTL keeps
 * results fresh enough while cutting search spend dramatically.
 *
 * The cache is keyed by namespace + leg + cabin/adults/currency, so different
 * providers (and different query params) never collide. `null` (no-fare) results
 * are cached too, to avoid re-querying empty legs.
 */

import { legKey, type FlightProvider } from './planner';
import type { FlightQuote, LegQuery, SearchOpts } from './types';

interface Entry {
  quote: FlightQuote | null;
  expires: number;
}

export class CachingProvider implements FlightProvider {
  constructor(
    private readonly inner: FlightProvider,
    private readonly store: Map<string, Entry>,
    private readonly opts: { ttlMs: number; namespace: string; now?: () => number },
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private key(q: LegQuery, o: SearchOpts): string {
    const excl = (o.excludeAirlines ?? []).slice().sort().join('.');
    return `${this.opts.namespace}|${legKey(q)}|${o.cabin}|${o.adults}|${o.currency || 'USD'}|${excl}`;
  }

  /** How many of these legs are NOT already cached fresh — i.e. would be billed. */
  countBillable(queries: LegQuery[], o: SearchOpts): number {
    const now = this.now();
    let n = 0;
    for (const q of queries) {
      const hit = this.store.get(this.key(q, o));
      if (!(hit && hit.expires > now)) n++;
    }
    return n;
  }

  async searchCheapest(q: LegQuery, o: SearchOpts): Promise<FlightQuote | null> {
    const now = this.now();
    const k = this.key(q, o);
    const hit = this.store.get(k);
    if (hit && hit.expires > now) return hit.quote;
    const quote = await this.inner.searchCheapest(q, o);
    this.store.set(k, { quote, expires: now + this.opts.ttlMs });
    return quote;
  }
}
