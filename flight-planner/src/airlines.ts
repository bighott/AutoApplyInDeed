/**
 * Airline name <-> IATA code lookup, used to filter out excluded airlines
 * regardless of whether a source reports a code or a name.
 */

const NAME_TO_IATA: Record<string, string> = {
  'American': 'AA', 'American Airlines': 'AA', 'Delta': 'DL', 'Delta Air Lines': 'DL',
  'United': 'UA', 'United Airlines': 'UA', 'Southwest': 'WN', 'Southwest Airlines': 'WN',
  'JetBlue': 'B6', 'Alaska': 'AS', 'Alaska Airlines': 'AS', 'Spirit': 'NK', 'Frontier': 'F9',
  'Hawaiian': 'HA', 'Hawaiian Airlines': 'HA', 'British Airways': 'BA', 'Virgin Atlantic': 'VS',
  'Air France': 'AF', 'KLM': 'KL', 'Lufthansa': 'LH', 'Swiss': 'LX', 'Austrian': 'OS',
  'Brussels Airlines': 'SN', 'Iberia': 'IB', 'TAP': 'TP', 'TAP Portugal': 'TP', 'TAP Air Portugal': 'TP',
  'Ryanair': 'FR', 'easyJet': 'U2', 'Vueling': 'VY', 'Norwegian': 'DY', 'SAS': 'SK', 'Finnair': 'AY',
  'Aer Lingus': 'EI', 'ITA Airways': 'AZ', 'Alitalia': 'AZ', 'Turkish Airlines': 'TK', 'Turkish': 'TK',
  'Aegean': 'A3', 'LOT': 'LO', 'Icelandair': 'FI', 'Emirates': 'EK', 'Qatar Airways': 'QR', 'Qatar': 'QR',
  'Etihad': 'EY', 'Saudia': 'SV', 'Royal Jordanian': 'RJ', 'Qantas': 'QF', 'Air Canada': 'AC',
  'WestJet': 'WS', 'Aeromexico': 'AM', 'LATAM': 'LA', 'Avianca': 'AV', 'Copa': 'CM', 'Copa Airlines': 'CM',
  'Azul': 'AD', 'GOL': 'G3', 'Singapore Airlines': 'SQ', 'Cathay Pacific': 'CX', 'ANA': 'NH',
  'All Nippon Airways': 'NH', 'Japan Airlines': 'JL', 'JAL': 'JL', 'Korean Air': 'KE', 'Asiana': 'OZ',
  'China Southern': 'CZ', 'China Eastern': 'MU', 'Air China': 'CA', 'EVA Air': 'BR', 'Thai Airways': 'TG',
  'Malaysia Airlines': 'MH', 'Garuda Indonesia': 'GA', 'Vietnam Airlines': 'VN', 'IndiGo': '6E',
  'Air India': 'AI', 'Ethiopian': 'ET', 'Ethiopian Airlines': 'ET', 'South African Airways': 'SA',
  'Kenya Airways': 'KQ', 'Royal Air Maroc': 'AT', 'EgyptAir': 'MS', 'El Al': 'LY', 'Air New Zealand': 'NZ',
  'Fiji Airways': 'FJ',
};

/** De-duplicated [code, name] list for pickers. */
export const AIRLINES: Array<{ code: string; name: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ code: string; name: string }> = [];
  for (const [name, code] of Object.entries(NAME_TO_IATA)) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
})();

export function codeForAirlineName(name?: string): string | undefined {
  if (!name) return undefined;
  return NAME_TO_IATA[name.trim()];
}

/**
 * All plausible IATA codes for an airline label, which may be a code already,
 * a name, or a combined "Delta/Virgin Atlantic" string.
 */
export function airlineCodesFromLabel(label?: string): string[] {
  if (!label) return [];
  const out = new Set<string>();
  for (const part of String(label).split(/[/,&+]| and /i)) {
    const t = part.trim();
    if (!t) continue;
    if (/^[A-Z0-9]{2}$/.test(t)) out.add(t.toUpperCase());
    const code = codeForAirlineName(t);
    if (code) out.add(code);
  }
  return [...out];
}
