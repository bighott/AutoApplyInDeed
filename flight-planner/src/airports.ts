/**
 * Embedded airport directory for the UI's type-ahead. A curated set of ~230
 * major international airports — enough for useful autocomplete without a
 * network dependency. Each entry: IATA code, primary city, airport name, country.
 *
 * searchAirports() ranks matches: exact IATA, then IATA prefix, then city, then
 * name/country — so typing "lon", "lhr", or "heath" all surface London Heathrow.
 */

export interface Airport {
  iata: string;
  city: string;
  name: string;
  country: string;
}

// [iata, city, name, country]
const RAW: Array<[string, string, string, string]> = [
  // North America — USA
  ["ATL", "Atlanta", "Hartsfield–Jackson Atlanta Intl", "USA"],
  ["LAX", "Los Angeles", "Los Angeles Intl", "USA"],
  ["ORD", "Chicago", "O'Hare Intl", "USA"],
  ["DFW", "Dallas", "Dallas/Fort Worth Intl", "USA"],
  ["DEN", "Denver", "Denver Intl", "USA"],
  ["JFK", "New York", "John F. Kennedy Intl", "USA"],
  ["EWR", "Newark", "Newark Liberty Intl", "USA"],
  ["LGA", "New York", "LaGuardia", "USA"],
  ["SFO", "San Francisco", "San Francisco Intl", "USA"],
  ["OAK", "Oakland", "Oakland Intl", "USA"],
  ["SJC", "San Jose", "San Jose Intl", "USA"],
  ["SEA", "Seattle", "Seattle–Tacoma Intl", "USA"],
  ["LAS", "Las Vegas", "Harry Reid Intl", "USA"],
  ["MCO", "Orlando", "Orlando Intl", "USA"],
  ["MIA", "Miami", "Miami Intl", "USA"],
  ["FLL", "Fort Lauderdale", "Fort Lauderdale–Hollywood Intl", "USA"],
  ["PHX", "Phoenix", "Phoenix Sky Harbor Intl", "USA"],
  ["IAH", "Houston", "George Bush Intercontinental", "USA"],
  ["HOU", "Houston", "William P. Hobby", "USA"],
  ["BOS", "Boston", "Logan Intl", "USA"],
  ["MSP", "Minneapolis", "Minneapolis–Saint Paul Intl", "USA"],
  ["DTW", "Detroit", "Detroit Metropolitan", "USA"],
  ["PHL", "Philadelphia", "Philadelphia Intl", "USA"],
  ["CLT", "Charlotte", "Charlotte Douglas Intl", "USA"],
  ["BWI", "Baltimore", "Baltimore/Washington Intl", "USA"],
  ["DCA", "Washington", "Ronald Reagan National", "USA"],
  ["IAD", "Washington", "Dulles Intl", "USA"],
  ["SLC", "Salt Lake City", "Salt Lake City Intl", "USA"],
  ["SAN", "San Diego", "San Diego Intl", "USA"],
  ["TPA", "Tampa", "Tampa Intl", "USA"],
  ["PDX", "Portland", "Portland Intl", "USA"],
  ["HNL", "Honolulu", "Daniel K. Inouye Intl", "USA"],
  ["AUS", "Austin", "Austin–Bergstrom Intl", "USA"],
  ["MDW", "Chicago", "Chicago Midway", "USA"],
  ["BNA", "Nashville", "Nashville Intl", "USA"],
  ["RDU", "Raleigh", "Raleigh–Durham Intl", "USA"],
  ["SMF", "Sacramento", "Sacramento Intl", "USA"],
  ["SNA", "Santa Ana", "John Wayne", "USA"],
  ["DAL", "Dallas", "Dallas Love Field", "USA"],
  ["STL", "St. Louis", "St. Louis Lambert Intl", "USA"],
  ["MCI", "Kansas City", "Kansas City Intl", "USA"],
  ["CLE", "Cleveland", "Cleveland Hopkins Intl", "USA"],
  ["PIT", "Pittsburgh", "Pittsburgh Intl", "USA"],
  ["CVG", "Cincinnati", "Cincinnati/Northern Kentucky Intl", "USA"],
  ["IND", "Indianapolis", "Indianapolis Intl", "USA"],
  ["CMH", "Columbus", "John Glenn Columbus Intl", "USA"],
  ["MKE", "Milwaukee", "Milwaukee Mitchell Intl", "USA"],
  ["ONT", "Ontario", "Ontario Intl", "USA"],
  ["BUR", "Burbank", "Hollywood Burbank", "USA"],
  ["ABQ", "Albuquerque", "Albuquerque Intl Sunport", "USA"],
  ["ANC", "Anchorage", "Ted Stevens Anchorage Intl", "USA"],
  ["BUF", "Buffalo", "Buffalo Niagara Intl", "USA"],
  ["JAX", "Jacksonville", "Jacksonville Intl", "USA"],
  ["RSW", "Fort Myers", "Southwest Florida Intl", "USA"],
  ["PBI", "West Palm Beach", "Palm Beach Intl", "USA"],
  // Canada
  ["YYZ", "Toronto", "Toronto Pearson Intl", "Canada"],
  ["YVR", "Vancouver", "Vancouver Intl", "Canada"],
  ["YUL", "Montreal", "Montréal–Trudeau Intl", "Canada"],
  ["YYC", "Calgary", "Calgary Intl", "Canada"],
  ["YEG", "Edmonton", "Edmonton Intl", "Canada"],
  ["YOW", "Ottawa", "Ottawa Macdonald–Cartier Intl", "Canada"],
  ["YWG", "Winnipeg", "Winnipeg Richardson Intl", "Canada"],
  ["YHZ", "Halifax", "Halifax Stanfield Intl", "Canada"],
  // Mexico / Central America / Caribbean
  ["MEX", "Mexico City", "Mexico City Intl", "Mexico"],
  ["CUN", "Cancún", "Cancún Intl", "Mexico"],
  ["GDL", "Guadalajara", "Guadalajara Intl", "Mexico"],
  ["MTY", "Monterrey", "Monterrey Intl", "Mexico"],
  ["SJD", "Los Cabos", "Los Cabos Intl", "Mexico"],
  ["PVR", "Puerto Vallarta", "Puerto Vallarta Intl", "Mexico"],
  ["PTY", "Panama City", "Tocumen Intl", "Panama"],
  ["SJO", "San José", "Juan Santamaría Intl", "Costa Rica"],
  ["HAV", "Havana", "José Martí Intl", "Cuba"],
  ["SJU", "San Juan", "Luis Muñoz Marín Intl", "Puerto Rico"],
  ["PUJ", "Punta Cana", "Punta Cana Intl", "Dominican Republic"],
  ["SDQ", "Santo Domingo", "Las Américas Intl", "Dominican Republic"],
  ["MBJ", "Montego Bay", "Sangster Intl", "Jamaica"],
  ["NAS", "Nassau", "Lynden Pindling Intl", "Bahamas"],
  // South America
  ["GRU", "São Paulo", "Guarulhos Intl", "Brazil"],
  ["GIG", "Rio de Janeiro", "Galeão Intl", "Brazil"],
  ["BSB", "Brasília", "Brasília Intl", "Brazil"],
  ["EZE", "Buenos Aires", "Ministro Pistarini (Ezeiza)", "Argentina"],
  ["AEP", "Buenos Aires", "Aeroparque Jorge Newbery", "Argentina"],
  ["SCL", "Santiago", "Arturo Merino Benítez Intl", "Chile"],
  ["BOG", "Bogotá", "El Dorado Intl", "Colombia"],
  ["MDE", "Medellín", "José María Córdova Intl", "Colombia"],
  ["LIM", "Lima", "Jorge Chávez Intl", "Peru"],
  ["UIO", "Quito", "Mariscal Sucre Intl", "Ecuador"],
  ["GYE", "Guayaquil", "José Joaquín de Olmedo Intl", "Ecuador"],
  ["CCS", "Caracas", "Simón Bolívar Intl", "Venezuela"],
  ["MVD", "Montevideo", "Carrasco Intl", "Uruguay"],
  ["LPB", "La Paz", "El Alto Intl", "Bolivia"],
  ["ASU", "Asunción", "Silvio Pettirossi Intl", "Paraguay"],
  // Europe — UK & Ireland
  ["LHR", "London", "Heathrow", "UK"],
  ["LGW", "London", "Gatwick", "UK"],
  ["STN", "London", "Stansted", "UK"],
  ["LTN", "London", "Luton", "UK"],
  ["LCY", "London", "London City", "UK"],
  ["MAN", "Manchester", "Manchester", "UK"],
  ["EDI", "Edinburgh", "Edinburgh", "UK"],
  ["BHX", "Birmingham", "Birmingham", "UK"],
  ["GLA", "Glasgow", "Glasgow", "UK"],
  ["DUB", "Dublin", "Dublin", "Ireland"],
  // Europe — Western
  ["CDG", "Paris", "Charles de Gaulle", "France"],
  ["ORY", "Paris", "Orly", "France"],
  ["NCE", "Nice", "Côte d'Azur", "France"],
  ["LYS", "Lyon", "Lyon–Saint-Exupéry", "France"],
  ["AMS", "Amsterdam", "Schiphol", "Netherlands"],
  ["FRA", "Frankfurt", "Frankfurt", "Germany"],
  ["MUC", "Munich", "Munich", "Germany"],
  ["BER", "Berlin", "Berlin Brandenburg", "Germany"],
  ["DUS", "Düsseldorf", "Düsseldorf", "Germany"],
  ["HAM", "Hamburg", "Hamburg", "Germany"],
  ["CGN", "Cologne", "Cologne Bonn", "Germany"],
  ["STR", "Stuttgart", "Stuttgart", "Germany"],
  ["BRU", "Brussels", "Brussels", "Belgium"],
  ["ZRH", "Zurich", "Zurich", "Switzerland"],
  ["GVA", "Geneva", "Geneva", "Switzerland"],
  ["VIE", "Vienna", "Vienna Intl", "Austria"],
  ["LUX", "Luxembourg", "Luxembourg", "Luxembourg"],
  // Europe — Southern
  ["MAD", "Madrid", "Adolfo Suárez Madrid–Barajas", "Spain"],
  ["BCN", "Barcelona", "Josep Tarradellas Barcelona–El Prat", "Spain"],
  ["AGP", "Málaga", "Málaga–Costa del Sol", "Spain"],
  ["PMI", "Palma", "Palma de Mallorca", "Spain"],
  ["VLC", "Valencia", "Valencia", "Spain"],
  ["FCO", "Rome", "Leonardo da Vinci–Fiumicino", "Italy"],
  ["MXP", "Milan", "Malpensa", "Italy"],
  ["LIN", "Milan", "Linate", "Italy"],
  ["BGY", "Milan", "Bergamo Orio al Serio", "Italy"],
  ["VCE", "Venice", "Marco Polo", "Italy"],
  ["NAP", "Naples", "Naples Intl", "Italy"],
  ["LIS", "Lisbon", "Humberto Delgado", "Portugal"],
  ["OPO", "Porto", "Francisco Sá Carneiro", "Portugal"],
  ["ATH", "Athens", "Eleftherios Venizelos", "Greece"],
  // Europe — Nordic
  ["CPH", "Copenhagen", "Copenhagen", "Denmark"],
  ["ARN", "Stockholm", "Arlanda", "Sweden"],
  ["OSL", "Oslo", "Gardermoen", "Norway"],
  ["HEL", "Helsinki", "Helsinki-Vantaa", "Finland"],
  ["KEF", "Reykjavík", "Keflavík", "Iceland"],
  // Europe — Central/Eastern & Turkey
  ["IST", "Istanbul", "Istanbul Airport", "Turkey"],
  ["SAW", "Istanbul", "Sabiha Gökçen", "Turkey"],
  ["AYT", "Antalya", "Antalya", "Turkey"],
  ["WAW", "Warsaw", "Chopin", "Poland"],
  ["KRK", "Kraków", "John Paul II", "Poland"],
  ["PRG", "Prague", "Václav Havel", "Czechia"],
  ["BUD", "Budapest", "Ferenc Liszt Intl", "Hungary"],
  ["OTP", "Bucharest", "Henri Coandă Intl", "Romania"],
  ["SOF", "Sofia", "Sofia", "Bulgaria"],
  ["ZAG", "Zagreb", "Franjo Tuđman", "Croatia"],
  ["BEG", "Belgrade", "Nikola Tesla", "Serbia"],
  ["RIX", "Riga", "Riga Intl", "Latvia"],
  ["TLL", "Tallinn", "Lennart Meri Tallinn", "Estonia"],
  ["VNO", "Vilnius", "Vilnius", "Lithuania"],
  ["SVO", "Moscow", "Sheremetyevo", "Russia"],
  ["DME", "Moscow", "Domodedovo", "Russia"],
  ["LED", "Saint Petersburg", "Pulkovo", "Russia"],
  ["KBP", "Kyiv", "Boryspil Intl", "Ukraine"],
  // Middle East
  ["DXB", "Dubai", "Dubai Intl", "UAE"],
  ["DWC", "Dubai", "Al Maktoum Intl", "UAE"],
  ["AUH", "Abu Dhabi", "Zayed Intl", "UAE"],
  ["DOH", "Doha", "Hamad Intl", "Qatar"],
  ["JED", "Jeddah", "King Abdulaziz Intl", "Saudi Arabia"],
  ["RUH", "Riyadh", "King Khalid Intl", "Saudi Arabia"],
  ["KWI", "Kuwait City", "Kuwait Intl", "Kuwait"],
  ["BAH", "Manama", "Bahrain Intl", "Bahrain"],
  ["MCT", "Muscat", "Muscat Intl", "Oman"],
  ["AMM", "Amman", "Queen Alia Intl", "Jordan"],
  ["BEY", "Beirut", "Rafic Hariri Intl", "Lebanon"],
  ["TLV", "Tel Aviv", "Ben Gurion", "Israel"],
  ["CAI", "Cairo", "Cairo Intl", "Egypt"],
  // Africa
  ["JNB", "Johannesburg", "O.R. Tambo Intl", "South Africa"],
  ["CPT", "Cape Town", "Cape Town Intl", "South Africa"],
  ["DUR", "Durban", "King Shaka Intl", "South Africa"],
  ["NBO", "Nairobi", "Jomo Kenyatta Intl", "Kenya"],
  ["ADD", "Addis Ababa", "Bole Intl", "Ethiopia"],
  ["LOS", "Lagos", "Murtala Muhammed Intl", "Nigeria"],
  ["ABV", "Abuja", "Nnamdi Azikiwe Intl", "Nigeria"],
  ["ACC", "Accra", "Kotoka Intl", "Ghana"],
  ["CMN", "Casablanca", "Mohammed V Intl", "Morocco"],
  ["RAK", "Marrakesh", "Marrakesh Menara", "Morocco"],
  ["TUN", "Tunis", "Tunis–Carthage", "Tunisia"],
  ["ALG", "Algiers", "Houari Boumediene", "Algeria"],
  ["DAR", "Dar es Salaam", "Julius Nyerere Intl", "Tanzania"],
  ["DKR", "Dakar", "Blaise Diagne Intl", "Senegal"],
  // Asia — East
  ["HND", "Tokyo", "Haneda", "Japan"],
  ["NRT", "Tokyo", "Narita Intl", "Japan"],
  ["KIX", "Osaka", "Kansai Intl", "Japan"],
  ["NGO", "Nagoya", "Chubu Centrair Intl", "Japan"],
  ["FUK", "Fukuoka", "Fukuoka", "Japan"],
  ["CTS", "Sapporo", "New Chitose", "Japan"],
  ["ICN", "Seoul", "Incheon Intl", "South Korea"],
  ["GMP", "Seoul", "Gimpo Intl", "South Korea"],
  ["PEK", "Beijing", "Beijing Capital Intl", "China"],
  ["PKX", "Beijing", "Beijing Daxing Intl", "China"],
  ["PVG", "Shanghai", "Pudong Intl", "China"],
  ["SHA", "Shanghai", "Hongqiao Intl", "China"],
  ["CAN", "Guangzhou", "Baiyun Intl", "China"],
  ["SZX", "Shenzhen", "Bao'an Intl", "China"],
  ["CTU", "Chengdu", "Tianfu Intl", "China"],
  ["CKG", "Chongqing", "Jiangbei Intl", "China"],
  ["XIY", "Xi'an", "Xianyang Intl", "China"],
  ["HGH", "Hangzhou", "Xiaoshan Intl", "China"],
  ["HKG", "Hong Kong", "Hong Kong Intl", "Hong Kong"],
  ["TPE", "Taipei", "Taoyuan Intl", "Taiwan"],
  ["MFM", "Macau", "Macau Intl", "Macau"],
  // Asia — Southeast
  ["SIN", "Singapore", "Changi", "Singapore"],
  ["KUL", "Kuala Lumpur", "Kuala Lumpur Intl", "Malaysia"],
  ["BKK", "Bangkok", "Suvarnabhumi", "Thailand"],
  ["DMK", "Bangkok", "Don Mueang Intl", "Thailand"],
  ["HKT", "Phuket", "Phuket Intl", "Thailand"],
  ["CGK", "Jakarta", "Soekarno–Hatta Intl", "Indonesia"],
  ["DPS", "Bali", "Ngurah Rai (Denpasar)", "Indonesia"],
  ["MNL", "Manila", "Ninoy Aquino Intl", "Philippines"],
  ["CEB", "Cebu", "Mactan–Cebu Intl", "Philippines"],
  ["SGN", "Ho Chi Minh City", "Tan Son Nhat Intl", "Vietnam"],
  ["HAN", "Hanoi", "Noi Bai Intl", "Vietnam"],
  ["PNH", "Phnom Penh", "Phnom Penh Intl", "Cambodia"],
  ["RGN", "Yangon", "Yangon Intl", "Myanmar"],
  // Asia — South & Central
  ["DEL", "Delhi", "Indira Gandhi Intl", "India"],
  ["BOM", "Mumbai", "Chhatrapati Shivaji Maharaj Intl", "India"],
  ["BLR", "Bengaluru", "Kempegowda Intl", "India"],
  ["MAA", "Chennai", "Chennai Intl", "India"],
  ["HYD", "Hyderabad", "Rajiv Gandhi Intl", "India"],
  ["CCU", "Kolkata", "Netaji Subhas Chandra Bose Intl", "India"],
  ["COK", "Kochi", "Cochin Intl", "India"],
  ["DAC", "Dhaka", "Hazrat Shahjalal Intl", "Bangladesh"],
  ["CMB", "Colombo", "Bandaranaike Intl", "Sri Lanka"],
  ["KTM", "Kathmandu", "Tribhuvan Intl", "Nepal"],
  ["ISB", "Islamabad", "Islamabad Intl", "Pakistan"],
  ["KHI", "Karachi", "Jinnah Intl", "Pakistan"],
  ["LHE", "Lahore", "Allama Iqbal Intl", "Pakistan"],
  ["TAS", "Tashkent", "Islam Karimov Tashkent Intl", "Uzbekistan"],
  ["ALA", "Almaty", "Almaty Intl", "Kazakhstan"],
  // Oceania
  ["SYD", "Sydney", "Kingsford Smith", "Australia"],
  ["MEL", "Melbourne", "Melbourne (Tullamarine)", "Australia"],
  ["BNE", "Brisbane", "Brisbane", "Australia"],
  ["PER", "Perth", "Perth", "Australia"],
  ["ADL", "Adelaide", "Adelaide", "Australia"],
  ["OOL", "Gold Coast", "Gold Coast", "Australia"],
  ["CNS", "Cairns", "Cairns", "Australia"],
  ["AKL", "Auckland", "Auckland", "New Zealand"],
  ["CHC", "Christchurch", "Christchurch", "New Zealand"],
  ["WLG", "Wellington", "Wellington", "New Zealand"],
  ["NAN", "Nadi", "Nadi Intl", "Fiji"],
  ["PPT", "Papeete", "Faa'a Intl", "French Polynesia"],
  ["GUM", "Hagåtña", "Antonio B. Won Pat Intl", "Guam"],
];

export const AIRPORTS: Airport[] = RAW.map(([iata, city, name, country]) => ({
  iata,
  city,
  name,
  country,
}));

const CITY_BY_IATA = new Map(AIRPORTS.map((a) => [a.iata, a.city]));

/** City name for an IATA code, or undefined if not in the directory. */
export function cityOf(code: string): string | undefined {
  return CITY_BY_IATA.get(String(code).trim().toUpperCase());
}

/** Approximate [lat, lon] for each airport — enough for geographic route ordering. */
const COORDS: Record<string, [number, number]> = {
  ATL:[33.64,-84.43],LAX:[33.94,-118.41],ORD:[41.98,-87.90],DFW:[32.90,-97.04],DEN:[39.86,-104.67],
  JFK:[40.64,-73.78],EWR:[40.69,-74.17],LGA:[40.78,-73.87],SFO:[37.62,-122.38],OAK:[37.71,-122.21],
  SJC:[37.36,-121.93],SEA:[47.45,-122.31],LAS:[36.08,-115.15],MCO:[28.43,-81.31],MIA:[25.79,-80.29],
  FLL:[26.07,-80.15],PHX:[33.43,-112.01],IAH:[29.98,-95.34],HOU:[29.65,-95.28],BOS:[42.36,-71.01],
  MSP:[44.88,-93.22],DTW:[42.21,-83.35],PHL:[39.87,-75.24],CLT:[35.21,-80.94],BWI:[39.18,-76.67],
  DCA:[38.85,-77.04],IAD:[38.95,-77.46],SLC:[40.79,-111.98],SAN:[32.73,-117.19],TPA:[27.98,-82.53],
  PDX:[45.59,-122.60],HNL:[21.32,-157.92],AUS:[30.19,-97.67],MDW:[41.79,-87.75],BNA:[36.13,-86.67],
  RDU:[35.88,-78.79],SMF:[38.70,-121.59],SNA:[33.68,-117.87],DAL:[32.85,-96.85],STL:[38.75,-90.37],
  MCI:[39.30,-94.71],CLE:[41.41,-81.85],PIT:[40.49,-80.23],CVG:[39.05,-84.67],IND:[39.72,-86.29],
  CMH:[40.00,-82.89],MKE:[42.95,-87.90],ONT:[34.06,-117.60],BUR:[34.20,-118.36],ABQ:[35.04,-106.61],
  ANC:[61.17,-149.99],BUF:[42.94,-78.73],JAX:[30.49,-81.69],RSW:[26.54,-81.75],PBI:[26.68,-80.10],
  YYZ:[43.68,-79.61],YVR:[49.19,-123.18],YUL:[45.47,-73.74],YYC:[51.13,-114.01],YEG:[53.31,-113.58],
  YOW:[45.32,-75.67],YWG:[49.91,-97.24],YHZ:[44.88,-63.51],MEX:[19.44,-99.07],CUN:[21.04,-86.87],
  GDL:[20.52,-103.31],MTY:[25.78,-100.11],SJD:[23.15,-109.72],PVR:[20.68,-105.25],PTY:[9.07,-79.38],
  SJO:[9.99,-84.20],HAV:[22.99,-82.41],SJU:[18.44,-66.00],PUJ:[18.57,-68.36],SDQ:[18.43,-69.67],
  MBJ:[18.50,-77.91],NAS:[25.04,-77.46],GRU:[-23.43,-46.47],GIG:[-22.81,-43.25],BSB:[-15.87,-47.92],
  EZE:[-34.82,-58.54],AEP:[-34.56,-58.42],SCL:[-33.39,-70.79],BOG:[4.70,-74.15],MDE:[6.16,-75.42],
  LIM:[-12.02,-77.11],UIO:[-0.13,-78.36],GYE:[-2.16,-79.88],CCS:[10.60,-66.99],MVD:[-34.84,-56.03],
  LPB:[-16.51,-68.19],ASU:[-25.24,-57.52],LHR:[51.47,-0.45],LGW:[51.15,-0.18],STN:[51.89,0.24],
  LTN:[51.87,-0.37],LCY:[51.51,0.05],MAN:[53.35,-2.27],EDI:[55.95,-3.37],BHX:[52.45,-1.75],
  GLA:[55.87,-4.43],DUB:[53.42,-6.27],CDG:[49.01,2.55],ORY:[48.73,2.38],NCE:[43.66,7.21],
  LYS:[45.73,5.08],AMS:[52.31,4.76],FRA:[50.04,8.56],MUC:[48.35,11.79],BER:[52.36,13.50],
  DUS:[51.29,6.77],HAM:[53.63,10.01],CGN:[50.87,7.14],STR:[48.69,9.22],BRU:[50.90,4.48],
  ZRH:[47.46,8.55],GVA:[46.24,6.11],VIE:[48.11,16.57],LUX:[49.63,6.21],MAD:[40.47,-3.56],
  BCN:[41.30,2.08],AGP:[36.67,-4.50],PMI:[39.55,2.74],VLC:[39.49,-0.48],FCO:[41.80,12.25],
  MXP:[45.63,8.72],LIN:[45.45,9.28],BGY:[45.67,9.70],VCE:[45.51,12.35],NAP:[40.89,14.29],
  LIS:[38.77,-9.13],OPO:[41.24,-8.68],ATH:[37.94,23.95],CPH:[55.62,12.65],ARN:[59.65,17.92],
  OSL:[60.19,11.10],HEL:[60.32,24.96],KEF:[63.99,-22.61],IST:[41.26,28.74],SAW:[40.90,29.31],
  AYT:[36.90,30.79],WAW:[52.17,20.97],KRK:[50.08,19.79],PRG:[50.10,14.26],BUD:[47.44,19.26],
  OTP:[44.57,26.10],SOF:[42.69,23.41],ZAG:[45.74,16.07],BEG:[44.82,20.29],RIX:[56.92,23.97],
  TLL:[59.41,24.83],VNO:[54.64,25.29],SVO:[55.97,37.41],DME:[55.41,37.90],LED:[59.80,30.26],
  KBP:[50.34,30.89],DXB:[25.25,55.36],DWC:[24.90,55.16],AUH:[24.43,54.65],DOH:[25.27,51.61],
  JED:[21.68,39.16],RUH:[24.96,46.70],KWI:[29.24,47.97],BAH:[26.27,50.63],MCT:[23.59,58.28],
  AMM:[31.72,35.99],BEY:[33.82,35.49],TLV:[32.01,34.89],CAI:[30.11,31.41],JNB:[-26.13,28.24],
  CPT:[-33.97,18.60],DUR:[-29.61,31.12],NBO:[-1.32,36.93],ADD:[8.98,38.80],LOS:[6.58,3.32],
  ABV:[9.01,7.26],ACC:[5.61,-0.17],CMN:[33.37,-7.59],RAK:[31.61,-8.04],TUN:[36.85,10.23],
  ALG:[36.69,3.22],DAR:[-6.88,39.20],DKR:[14.74,-17.49],HND:[35.55,139.78],NRT:[35.77,140.39],
  KIX:[34.43,135.24],NGO:[34.86,136.81],FUK:[33.59,130.45],CTS:[42.78,141.69],ICN:[37.46,126.44],
  GMP:[37.56,126.80],PEK:[40.08,116.58],PKX:[39.51,116.41],PVG:[31.14,121.81],SHA:[31.20,121.34],
  CAN:[23.39,113.30],SZX:[22.64,113.81],CTU:[30.31,104.44],CKG:[29.72,106.64],XIY:[34.45,108.75],
  HGH:[30.23,120.43],HKG:[22.31,113.91],TPE:[25.08,121.23],MFM:[22.16,113.59],SIN:[1.36,103.99],
  KUL:[2.74,101.71],BKK:[13.69,100.75],DMK:[13.91,100.61],HKT:[8.11,98.31],CGK:[-6.13,106.66],
  DPS:[-8.75,115.17],MNL:[14.51,121.02],CEB:[10.31,123.98],SGN:[10.82,106.66],HAN:[21.22,105.81],
  PNH:[11.55,104.84],RGN:[16.91,96.13],DEL:[28.57,77.10],BOM:[19.09,72.87],BLR:[13.20,77.71],
  MAA:[12.99,80.17],HYD:[17.24,78.43],CCU:[22.65,88.45],COK:[10.15,76.40],DAC:[23.84,90.40],
  CMB:[7.18,79.88],KTM:[27.70,85.36],ISB:[33.55,72.83],KHI:[24.91,67.16],LHE:[31.52,74.40],
  TAS:[41.26,69.28],ALA:[43.35,77.04],SYD:[-33.95,151.18],MEL:[-37.67,144.84],BNE:[-27.38,153.12],
  PER:[-31.94,115.97],ADL:[-34.95,138.53],OOL:[-28.16,153.50],CNS:[-16.89,145.75],AKL:[-37.01,174.79],
  CHC:[-43.49,172.53],WLG:[-41.33,174.81],NAN:[-17.76,177.44],PPT:[-17.56,-149.61],GUM:[13.48,144.80],
};

/** Approximate [lat, lon] for an IATA code, or undefined if unknown. */
export function coordsOf(code: string): [number, number] | undefined {
  return COORDS[String(code).trim().toUpperCase()];
}

/** Great-circle distance in km between two [lat, lon] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Ranked type-ahead search over the embedded directory. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return AIRPORTS.slice(0, limit);

  const scored: Array<{ a: Airport; s: number }> = [];
  for (const a of AIRPORTS) {
    const iata = a.iata.toLowerCase();
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();
    const country = a.country.toLowerCase();
    let s = -1;
    if (iata === q) s = 0;
    else if (iata.startsWith(q)) s = 1;
    else if (city.startsWith(q)) s = 2;
    else if (city.includes(q)) s = 3;
    else if (name.toLowerCase().includes(q)) s = 4;
    else if (country.startsWith(q)) s = 5;
    if (s >= 0) scored.push({ a, s });
  }
  scored.sort((x, y) => x.s - y.s || x.a.city.localeCompare(y.a.city));
  return scored.slice(0, limit).map((x) => x.a);
}
