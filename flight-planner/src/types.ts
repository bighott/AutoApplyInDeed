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
  /** Inclusive maximum nights; optional — bounded by the trip's end date when omitted. */
  maxNights?: number;
}

export interface TripSpec {
  /** Starting airport, e.g. "SFO". Used as the sole origin when `origins` is unset. */
  origin: string;
  /**
   * Optional candidate origin airports. When present, the planner tries a round
   * trip from each and picks the cheapest — e.g. ["SFO","OAK","SJC"].
   */
  origins?: string[];
  /** Ordered intermediate stops. */
  stops: TripStop[];
  /** Whether to fly back to the origin after the last stop. */
  returnToOrigin: boolean;
  /** Earliest start date (ISO yyyy-mm-dd). */
  startDate: string;
  /** Latest the trip may end (ISO yyyy-mm-dd). When set, the planner finds the
   * best departure within [startDate, endDate] and lets stay lengths run up to it. */
  endDate?: string;
  /** How many start days to try, beginning at startDate (1 = fixed start). */
  startFlexDays: number;
  adults: number;
  cabin: CabinClass;
  currency?: string;
  /** IATA airline codes to exclude from results (optional). */
  excludeAirlines?: string[];
}

/** A single origin→destination search on a specific date. */
export interface LegQuery {
  origin: string;
  destination: string;
  /** ISO yyyy-mm-dd. */
  date: string;
}

/** Options passed to a provider for a single leg search. */
export interface SearchOpts {
  adults: number;
  cabin: string;
  currency?: string;
  /** IATA airline codes to exclude from results. */
  excludeAirlines?: string[];
}

/** The cheapest quote a provider returned for one leg/date. */
export interface FlightQuote {
  price: number;
  currency: string;
  airline?: string;
  /** 2-letter IATA airline code, when known (for logo lookup). */
  airlineCode?: string;
  /** Primary marketing flight number, e.g. "FI618". */
  flightNumber?: string;
  /** Direct airline logo URL, when the source provides one. */
  airlineLogo?: string;
  stops?: number;
  durationLabel?: string;
  /** Total travel time in minutes (for ranking by flight time). */
  durationMinutes?: number;
  departTime?: string;
  arriveTime?: string;
  /** Checked bags already included in the fare (Amadeus), when known. */
  includedBags?: number;
  /** Seats left on the cheapest fare; null when unknown. */
  seatsLeft?: number | null;
  bookingLabel?: string;
  /** Clickable link to view/book this leg. */
  bookingUrl?: string;
  /** Individual flight segments when the leg connects (e.g. JFK→KEF→LHR). */
  segments?: FlightSegment[];
}

export interface FlightSegment {
  from?: string;
  to?: string;
  airline?: string;
  airlineCode?: string;
  flightNumber?: string;
  departTime?: string;
  arriveTime?: string;
}

export interface PricedLeg extends LegQuery {
  quote: FlightQuote | null;
}

export interface ItineraryResult {
  /** Origin airport this itinerary departs from. */
  origin: string;
  /** Origin airport the return leg flies into (may differ from `origin`); null if no return. */
  returnOrigin: string | null;
  /** Concrete start date used for this itinerary. */
  startDate: string;
  /** Nights chosen at each stop (parallel to TripSpec.stops). */
  nightsPerStop: number[];
  /** Each priced leg in travel order. */
  legs: PricedLeg[];
  /** Sum of leg prices. */
  total: number;
  currency: string;
  /** Sum of leg flight times in minutes; null if any leg's duration is unknown. */
  totalDurationMinutes: number | null;
  /** Visit order (destination codes) — set by the route-optimizing "Plan my trip" advisor. */
  order?: string[];
}

export interface PlanResult {
  /** Cheapest feasible itinerary, or null if none could be fully priced. */
  best: ItineraryResult | null;
  /** Shortest total flight time among feasible itineraries, when durations are known. */
  fastest: ItineraryResult | null;
  /** Best price/time trade-off (normalized score), when durations are known. */
  bestValue: ItineraryResult | null;
  /** All feasible itineraries, sorted cheapest-first. */
  allItineraries: ItineraryResult[];
  /** Every unique leg/date that was priced — the multi-day search matrix. */
  legGrid: PricedLeg[];
  /** Number of unique provider searches performed. */
  queriesRun: number;
  /** True if combos/start dates were sampled to stay efficient. */
  sampled?: boolean;
  /** Largest start-date step used when sampling (1 = every day). */
  dateStepDays?: number;
}

// ============================================================================
// Accommodation ("Stays") model — hotels & vacation rentals near a destination.
// Mirrors the flight side: a provider-agnostic interface, with the price/rating/
// radius filtering done by the stays orchestrator so every source behaves alike.
// ============================================================================

export type StayType = 'hotel' | 'vacation_rental' | 'other';

/** One accommodation search: where, when, and for whom. */
export interface StayQuery {
  /** Free-text location for the source query, e.g. "Paris" or "Rome, Italy". */
  location: string;
  /** Optional IATA anchor (e.g. the arrival airport) used to measure radius. */
  anchorCode?: string;
  /** Explicit anchor coordinates; override anchorCode when provided. */
  lat?: number;
  lon?: number;
  /** Check-in / check-out (ISO yyyy-mm-dd). */
  checkIn: string;
  checkOut: string;
  adults: number;
  currency?: string;
  /** Also query vacation rentals (Airbnb-style). May cost an extra search. */
  includeVacationRentals?: boolean;
}

/** Post-filters applied by the orchestrator after a source returns candidates. */
export interface StayFilters {
  /** Max great-circle distance (km) from the anchor. */
  radiusKm?: number;
  /** Per-night price bounds. */
  minPrice?: number;
  maxPrice?: number;
  /** Minimum overall rating (0–5). */
  minRating?: number;
  /** Restrict to these property types. */
  types?: StayType[];
}

export interface StaySearchOpts {
  adults: number;
  currency?: string;
  /** Cap on how many candidates a source returns (cost/latency guard). */
  maxResults?: number;
  includeVacationRentals?: boolean;
}

/** A single place to stay, normalized across sources. */
export interface Stay {
  name: string;
  type: StayType;
  /** Lowest nightly rate; null when the source didn't price it. */
  pricePerNight: number | null;
  /** Total for the whole stay; null when unknown. */
  totalPrice: number | null;
  currency: string;
  /** Overall rating on a 0–5 scale; null when unknown. */
  rating: number | null;
  reviews: number | null;
  lat?: number;
  lon?: number;
  /** Distance from the anchor in km; filled by the orchestrator. */
  distanceKm?: number | null;
  address?: string;
  thumbnail?: string;
  amenities?: string[];
  bookingUrl?: string;
  /** Which source produced this result. */
  source?: string;
}

/** A source of accommodation results (SerpApi Google Hotels, mock, …). */
export interface AccommodationProvider {
  readonly name: string;
  searchStays(q: StayQuery, opts: StaySearchOpts): Promise<Stay[]>;
}

