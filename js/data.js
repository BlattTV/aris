/**
 * Seed-Datenbasis: Attraktionen in Coburg & Umkreis (~30 km) mit
 * geschätzten Jahresbesucherzahlen (öffentliche Quellen / Tourismusstatistik,
 * Stand der Pflege siehe "updated"). Werte werden zur Laufzeit durch
 * Saisonfaktoren und optionale Live-Aktualisierung (Overpass) angereichert.
 */

export const CATEGORIES = {
  kultur:  { label: "Kultur & Museum", color: "#a78bfa", icon: "🏛️" },
  freizeit:{ label: "Freizeit & Familie", color: "#34d399", icon: "🎡" },
  therme:  { label: "Therme & Bad", color: "#38bdf8", icon: "💧" },
  natur:   { label: "Natur & Wandern", color: "#84cc16", icon: "🌲" },
  event:   { label: "Event & Festival", color: "#f472b6", icon: "🎪" },
  sport:   { label: "Sport & Arena", color: "#fb923c", icon: "⚽" },
  einkauf: { label: "Einkauf & Zentrum", color: "#facc15", icon: "🛍️" },
  regional:{ label: "Hofladen & Markt", color: "#a3e635", icon: "🧑‍🌾" },
};

// Saisonfaktoren je Monat (Index 0 = Januar). Kalibriert auf fränkische
// Tourismusströme: Sommerspitze, Dezember-Weihnachtsmarkt-Effekt.
export const SEASONALITY = {
  kultur:   [0.7, 0.7, 0.9, 1.0, 1.1, 1.1, 1.3, 1.4, 1.1, 1.0, 0.8, 1.0],
  freizeit: [0.4, 0.5, 0.8, 1.1, 1.3, 1.4, 1.6, 1.6, 1.2, 0.9, 0.5, 0.7],
  therme:   [1.3, 1.2, 1.1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3],
  natur:    [0.4, 0.5, 0.9, 1.2, 1.4, 1.4, 1.5, 1.5, 1.3, 1.0, 0.5, 0.4],
  event:    [0.3, 0.6, 0.7, 0.9, 1.2, 1.4, 2.2, 1.5, 1.0, 0.8, 0.6, 1.8],
  sport:    [1.2, 1.2, 1.1, 1.0, 0.8, 0.6, 0.5, 0.8, 1.1, 1.2, 1.3, 1.2],
  einkauf:  [0.9, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.5],
  regional: [0.7, 0.7, 0.9, 1.1, 1.2, 1.2, 1.2, 1.2, 1.2, 1.1, 0.8, 1.0],
};

export const SEED_ATTRACTIONS = [
  // --- Stadt Coburg ---
  { id: "veste-coburg", name: "Veste Coburg (Kunstsammlungen)", cat: "kultur",
    lat: 50.2640, lng: 10.9744, visitors: 200000, dwellMin: 120,
    note: "Eine der größten Burganlagen Deutschlands", updated: "2026-05" },
  { id: "schloss-ehrenburg", name: "Schloss Ehrenburg", cat: "kultur",
    lat: 50.2566, lng: 10.9670, visitors: 40000, dwellMin: 75, updated: "2026-05" },
  { id: "landestheater", name: "Landestheater Coburg", cat: "kultur",
    lat: 50.2572, lng: 10.9678, visitors: 120000, dwellMin: 150, updated: "2026-05" },
  { id: "naturkundemuseum", name: "Naturkunde-Museum Coburg", cat: "kultur",
    lat: 50.2588, lng: 10.9706, visitors: 45000, dwellMin: 90, updated: "2026-05" },
  { id: "marktplatz-coburg", name: "Marktplatz Coburg (Innenstadt)", cat: "einkauf",
    lat: 50.2585, lng: 10.9645, visitors: 1800000, dwellMin: 60,
    note: "Fußgängerzone, Wochenmarkt, Weihnachtsmarkt", updated: "2026-05" },
  { id: "aquaria", name: "Aquaria Erlebnisbad Coburg", cat: "therme",
    lat: 50.2531, lng: 10.9560, visitors: 250000, dwellMin: 180, updated: "2026-05" },
  { id: "huk-arena", name: "HUK-COBURG arena (HSC 2000)", cat: "sport",
    lat: 50.2483, lng: 10.9521, visitors: 90000, dwellMin: 150,
    note: "Handball-Heimspiele, Konzerte, Messen", updated: "2026-05" },
  { id: "sambafestival", name: "Internationales Samba-Festival", cat: "event",
    lat: 50.2580, lng: 10.9640, visitors: 200000, dwellMin: 240,
    note: "Jährlich im Juli, 3 Tage – größtes Samba-Festival außerhalb Brasiliens", updated: "2026-05" },
  { id: "hofgarten", name: "Hofgarten Coburg", cat: "natur",
    lat: 50.2610, lng: 10.9700, visitors: 350000, dwellMin: 60, updated: "2026-05" },
  { id: "kongresshaus", name: "Kongresshaus Rosengarten", cat: "event",
    lat: 50.2630, lng: 10.9665, visitors: 80000, dwellMin: 180, updated: "2026-05" },

  // --- Landkreis Coburg ---
  { id: "schloss-callenberg", name: "Schloss Callenberg", cat: "kultur",
    lat: 50.2811, lng: 10.9170, visitors: 20000, dwellMin: 90, updated: "2026-05" },
  { id: "schloss-rosenau", name: "Schloss Rosenau (Rödental)", cat: "kultur",
    lat: 50.2960, lng: 11.0290, visitors: 25000, dwellMin: 75, updated: "2026-05" },
  { id: "wildpark-tambach", name: "Wildpark Schloss Tambach", cat: "freizeit",
    lat: 50.2272, lng: 10.8536, visitors: 70000, dwellMin: 180, updated: "2026-05" },
  { id: "therme-natur", name: "ThermeNatur Bad Rodach", cat: "therme",
    lat: 50.3420, lng: 10.7790, visitors: 150000, dwellMin: 210, updated: "2026-05" },
  { id: "sesslach", name: "Historische Altstadt Seßlach", cat: "kultur",
    lat: 50.1866, lng: 10.8420, visitors: 60000, dwellMin: 90, updated: "2026-05" },
  { id: "spielzeugmuseum-neustadt", name: "Museum der Dt. Spielzeugindustrie (Neustadt)", cat: "kultur",
    lat: 50.3290, lng: 11.1190, visitors: 15000, dwellMin: 75, updated: "2026-05" },

  // --- Umkreis (Lichtenfels / Kronach / Sonneberg) ---
  { id: "vierzehnheiligen", name: "Basilika Vierzehnheiligen", cat: "kultur",
    lat: 50.1116, lng: 11.0561, visitors: 500000, dwellMin: 60,
    note: "Bedeutender Wallfahrtsort", updated: "2026-05" },
  { id: "kloster-banz", name: "Kloster Banz", cat: "kultur",
    lat: 50.1149, lng: 11.0048, visitors: 100000, dwellMin: 90, updated: "2026-05" },
  { id: "obermain-therme", name: "Obermain Therme Bad Staffelstein", cat: "therme",
    lat: 50.1009, lng: 11.0090, visitors: 350000, dwellMin: 240, updated: "2026-05" },
  { id: "staffelberg", name: "Staffelberg", cat: "natur",
    lat: 50.0930, lng: 11.0640, visitors: 100000, dwellMin: 150,
    note: "Berg der Franken, beliebtes Wanderziel", updated: "2026-05" },
  { id: "festung-rosenberg", name: "Festung Rosenberg (Kronach)", cat: "kultur",
    lat: 50.2447, lng: 11.3300, visitors: 60000, dwellMin: 120, updated: "2026-05" },
  { id: "spielzeugmuseum-sonneberg", name: "Deutsches Spielzeugmuseum Sonneberg", cat: "kultur",
    lat: 50.3530, lng: 11.1700, visitors: 45000, dwellMin: 90, updated: "2026-05" },
];

// Bevölkerungsschwerpunkte für Einzugsgebiets-Berechnung
// (Einwohner, amtliche Zahlen gerundet)
export const POPULATION_CENTERS = [
  { name: "Coburg (Stadt)", lat: 50.2585, lng: 10.9645, pop: 41000 },
  { name: "Rödental", lat: 50.2940, lng: 11.0400, pop: 13200 },
  { name: "Neustadt b. Coburg", lat: 50.3290, lng: 11.1210, pop: 14900 },
  { name: "Sonneberg", lat: 50.3590, lng: 11.1740, pop: 22800 },
  { name: "Lichtenfels", lat: 50.1450, lng: 11.0590, pop: 20300 },
  { name: "Bad Staffelstein", lat: 50.1030, lng: 11.0010, pop: 10300 },
  { name: "Kronach", lat: 50.2410, lng: 11.3280, pop: 16400 },
  { name: "Bad Rodach", lat: 50.3430, lng: 10.7800, pop: 6500 },
  { name: "Seßlach", lat: 50.1870, lng: 10.8430, pop: 3900 },
  { name: "Ebersdorf b. Coburg", lat: 50.2210, lng: 11.0700, pop: 5500 },
  { name: "Dörfles-Esbach", lat: 50.2810, lng: 10.9920, pop: 3600 },
  { name: "Untersiemau", lat: 50.2080, lng: 10.9620, pop: 3400 },
  { name: "Grub am Forst", lat: 50.2330, lng: 11.0290, pop: 3300 },
  { name: "Weitramsdorf", lat: 50.2570, lng: 10.8770, pop: 4000 },
  { name: "Ahorn", lat: 50.2370, lng: 10.9430, pop: 4300 },
  { name: "Meeder", lat: 50.3160, lng: 10.9070, pop: 3300 },
  { name: "Sonnefeld", lat: 50.2680, lng: 11.1010, pop: 4700 },
  { name: "Weidhausen", lat: 50.2400, lng: 11.1330, pop: 3400 },
  { name: "Lautertal", lat: 50.3110, lng: 10.9670, pop: 3000 },
  { name: "Itzgrund", lat: 50.1670, lng: 10.9230, pop: 3000 },
];

export const DEFAULT_SETTINGS = {
  radiusKm: 2.0,
  // Anteil der Besucher/Passanten, die zu Automaten-Kunden werden (%)
  captureRatePct: 1.5,
  // Wie oft kauft ein Einwohner im Einzugsgebiet pro Jahr (Frequenz)
  residentBuysPerYear: 6,
  // Durchschnittlicher Bon je Kauf (€)
  avgTicketEur: 3.5,
  // Marge auf den Umsatz (%)
  marginPct: 45,
  // Betriebskosten je Automat und Monat (€): Standplatz, Strom, Logistik
  opexPerMachineMonth: 180,
  // Automatische Datenaktualisierung (Overpass) alle X Stunden (0 = aus)
  autoRefreshHours: 24,
  // Automatisch geladene OSM-/farmshops-Automaten als Wettbewerb einrechnen
  includeOsmMachines: true,
  // Saisonfaktor auf aktuellen Monat anwenden
  applySeasonality: true,
  // Modell automatisch aus Ist-Umsätzen kalibrieren
  autoCalibrate: true,
  // White-Label-Branchenprofil (siehe js/verticals.js)
  vertical: "automaten",
};
