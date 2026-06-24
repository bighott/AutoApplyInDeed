/**
 * Core data model for the multi-city, multi-day flight planner.
 *
 * A trip is an ordered list of stops, each with a *night range* (e.g. "stay in
 * New York 2–3 nights"). The planner expands those ranges into concrete
 * candidate departure dates, prices every leg/date via a pluggable provider,
 * and returns the cheapest feasible combination — i.e. it "searches over
 * multiple days for the best flight prices".
 */

export type CabinClass = 'ECONOMY' | 'PREMIUMECONOMY' | 'BUSINESS' | 'FIRST';

export interface TripStop {
  /** Airport or city code, e.g. "JFK" or "New York". */
  code: string;
  /** Optional human label for output. */
  label?: string;
  /** Inclusive minimum nights to stay before flying onward. */
  minNights: number;
  /** Inclusive maximum nights to stay before flying onward. */
  maxNights: number;
}

export interface TripSpec {
  /** Starting airport, e.g. "SFO". */
  origin: string;
  /** Ordered intermediate stops. */
  stops: TripStop[];
  /** Whether to fly back to the origin after the last stop. */
  returnToOrigin: boolean;
  /** Earliest start date (ISO yyyy-mm-dd). */
  startDate: string;
  /** How many start days to try, beginning at startDate (1 = fixed start). */
  startFlexDays: number;
  adults: number;
  cabin: CabinClass;
  currency?: string;
}

/** A single origin→destination search on a specific date. */
export interface LegQuery {
  origin: string;
  destination: string;
  /** ISO yyyy-mm-dd. */
  date: string;
}

/** The cheapest quote a provider returned for one leg/date. */
export interface FlightQuote {
  price: number;
  currency: string;
  airline?: string;
  stops?: number;
  durationLabel?: string;
  departTime?: string;
  arriveTime?: string;
  /** Seats left on the cheapest fare; null when unknown. */
  seatsLeft?: number | null;
  bookingLabel?: string;
}

export interface PricedLeg extends LegQuery {
  quote: FlightQuote | null;
}

export interface ItineraryResult {
  /** Concrete start date used for this itinerary. */
  startDate: string;
  /** Nights chosen at each stop (parallel to TripSpec.stops). */
  nightsPerStop: number[];
  /** Each priced leg in travel order. */
  legs: PricedLeg[];
  /** Sum of leg prices. */
  total: number;
  currency: string;
}

export interface PlanResult {
  /** Cheapest feasible itinerary, or null if none could be fully priced. */
  best: ItineraryResult | null;
  /** All feasible itineraries, sorted cheapest-first. */
  allItineraries: ItineraryResult[];
  /** Every unique leg/date that was priced — the multi-day search matrix. */
  legGrid: PricedLeg[];
  /** Number of unique provider searches performed. */
  queriesRun: number;
}
