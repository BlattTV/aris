/**
 * Import des Zensus-2022-Bevölkerungsgitters (offene Daten) in das
 * App-Format data/zensus.json (auf 1 km aggregiert, WGS84).
 *
 * Bezug der Quelldatei (CSV, ~0,5 GB entpackt):
 *   https://www.zensus2022.de → Ergebnisse → Gitterdaten →
 *   "Bevölkerungszahlen in Gitterzellen (100 m)" (CSV, EPSG:3035)
 *
 * Erwartetes Format (Semikolon-getrennt, Header in Zeile 1):
 *   GITTER_ID_100m;x_mp_100m;y_mp_100m;Einwohner
 *
 * Aufruf:
 *   node server/import-zensus.mjs /pfad/zur/zensus100m.csv [data-verzeichnis]
 */
import { createReadStream, promises as fs } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { laeaToWgs84 } from "./zensus.mjs";

const csvPath = process.argv[2];
const dataDir = process.argv[3] || path.join(process.cwd(), "data");

if (!csvPath) {
  console.error("Aufruf: node server/import-zensus.mjs <zensus100m.csv> [data-dir]");
  process.exit(1);
}

console.log("Lese", csvPath, "…");
const rl = readline.createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

// 100-m-Zellen zu 1-km-Zellen aggregieren (Schlüssel: km-Gitter in EPSG:3035)
const grid = new Map();
let lineNo = 0, used = 0, totalPop = 0;
let cols = { x: 1, y: 2, pop: 3 };

for await (const line of rl) {
  lineNo++;
  const parts = line.split(";");
  if (lineNo === 1) {
    // Spalten anhand des Headers erkennen (Format-Varianten der Veröffentlichungen)
    const h = parts.map((s) => s.trim().toLowerCase());
    cols.x = Math.max(h.findIndex((c) => c.startsWith("x_mp")), 1);
    cols.y = Math.max(h.findIndex((c) => c.startsWith("y_mp")), 2);
    cols.pop = h.findIndex((c) => c.includes("einwohner"));
    if (cols.pop < 0) cols.pop = 3;
    continue;
  }
  const x = Number(parts[cols.x]);
  const y = Number(parts[cols.y]);
  const pop = Number(String(parts[cols.pop] ?? "").replace(",", "."));
  if (!isFinite(x) || !isFinite(y) || !isFinite(pop) || pop <= 0) continue;
  const key = `${Math.floor(x / 1000)}|${Math.floor(y / 1000)}`;
  grid.set(key, (grid.get(key) || 0) + pop);
  used++;
  totalPop += pop;
  if (used % 500000 === 0) console.log(`  ${used} Zellen verarbeitet …`);
}

console.log(`Aggregiere ${used} 100-m-Zellen → ${grid.size} 1-km-Zellen (${Math.round(totalPop)} Einwohner) …`);

const cells = [];
for (const [key, pop] of grid) {
  const [kx, ky] = key.split("|").map(Number);
  const { lat, lng } = laeaToWgs84(kx * 1000 + 500, ky * 1000 + 500); // Zellmitte
  cells.push([Number(lat.toFixed(5)), Number(lng.toFixed(5)), Math.round(pop)]);
}

await fs.mkdir(dataDir, { recursive: true });
const out = path.join(dataDir, "zensus.json");
await fs.writeFile(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "Zensus 2022, Bevölkerung im 100-m-Gitter (© Statistische Ämter, dl-de/by-2-0), aggregiert auf 1 km",
  resolutionM: 1000,
  cells,
}));
console.log(`✅ ${out} geschrieben (${cells.length} Zellen). Server neu starten, um es zu laden.`);
