/**
 * Standort-Analyse Deutschland – Produktionsserver (ohne Abhängigkeiten).
 *
 * Aufgaben:
 *  - Statische Auslieferung der Web-App
 *  - REST-API mit nächtlich vorgeladenem Deutschland-Datenbestand
 *    (farmshops.eu-Datenmodell: Verkaufsautomaten, Hofläden, Wochenmärkte,
 *    Imkereien – direkt aus OpenStreetMap/Overpass) und Bevölkerungsdaten
 *  - Tile-Cache für Frequenzbringer-POIs (Tourismus, Bäder, Arenen …)
 *  - Selbständige tägliche Aktualisierung
 *
 * Start:        node server/server.mjs
 * Umgebung:     PORT (Standard 8080), HOST (0.0.0.0),
 *               UPDATE_INTERVAL_H (24), DATA_DIR (./data)
 */
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OVERPASS_URL, buildBboxQuery, buildGermanyFarmshopsQuery,
  buildGermanyPopulationQuery, parseElements, inBbox, parseBboxParam,
} from "../js/queries.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const GERMANY_FILE = path.join(DATA_DIR, "germany.json");
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const UPDATE_INTERVAL_H = Number(process.env.UPDATE_INTERVAL_H) || 24;
const TILE_TTL_MS = 24 * 60 * 60 * 1000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- Deutschland-Datenbestand ----------

let germany = { updatedAt: null, machines: [], regionalPois: [], population: [] };
let updateRunning = false;

async function loadGermany() {
  try {
    germany = JSON.parse(await fs.readFile(GERMANY_FILE, "utf8"));
    log(`Deutschland-Datenbestand geladen: ${germany.machines.length} Automaten, ` +
        `${germany.regionalPois.length} Hofläden/Märkte, ${germany.population.length} Orte ` +
        `(Stand ${germany.updatedAt})`);
  } catch {
    log("Noch kein Deutschland-Datenbestand vorhanden – wird beim ersten Update erzeugt.");
  }
}

async function overpass(query, label) {
  log(`Overpass-Abfrage: ${label} …`);
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "standort-analyse-deutschland/1.0 (Self-hosted business analysis)",
    },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status} (${label})`);
  const json = await res.json();
  log(`Overpass-Antwort: ${label} – ${json.elements?.length || 0} Elemente`);
  return json.elements || [];
}

/** Nächtliches Komplett-Update: ganz Deutschland (dauert einige Minuten). */
export async function updateGermany() {
  if (updateRunning) {
    log("Update läuft bereits – übersprungen.");
    return false;
  }
  updateRunning = true;
  try {
    const farmshopElements = await overpass(
      buildGermanyFarmshopsQuery(), "farmshops-Datenmodell Deutschland");
    const popElements = await overpass(
      buildGermanyPopulationQuery(), "Bevölkerung Deutschland");

    const parsed = parseElements(farmshopElements);
    const population = parseElements(popElements).population;

    // Plausibilitätsschutz: ein fehlgeschlagener/leerer Lauf darf einen
    // vorhandenen guten Datenbestand nicht überschreiben.
    if (parsed.machines.length < 100 && germany.machines.length > 1000) {
      throw new Error("Update verworfen: verdächtig wenig Automaten erhalten");
    }

    germany = {
      updatedAt: new Date().toISOString(),
      machines: parsed.machines,
      regionalPois: parsed.pois, // shop=farm, marketplace, beekeeper
      population,
    };
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = GERMANY_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(germany));
    await fs.rename(tmp, GERMANY_FILE);
    log(`✅ Deutschland-Update fertig: ${germany.machines.length} Automaten, ` +
        `${germany.regionalPois.length} Hofläden/Märkte, ${germany.population.length} Orte`);
    return true;
  } catch (e) {
    log("❌ Deutschland-Update fehlgeschlagen: " + e.message);
    return false;
  } finally {
    updateRunning = false;
  }
}

function scheduleUpdates() {
  const due = () => {
    if (!germany.updatedAt) return true;
    return (Date.now() - new Date(germany.updatedAt).getTime()) / 36e5 >= UPDATE_INTERVAL_H;
  };
  const tick = () => { if (due()) updateGermany(); };
  setTimeout(tick, 10_000);              // kurz nach dem Start prüfen
  setInterval(tick, 30 * 60 * 1000);     // danach alle 30 Minuten prüfen
}

// ---------- POI-Tile-Cache (Frequenzbringer je Kartenausschnitt) ----------

function quantizeBbox(bbox) {
  const q = 0.2;
  return {
    s: Math.floor(bbox.s / q) * q,
    w: Math.floor(bbox.w / q) * q,
    n: Math.ceil(bbox.n / q) * q,
    e: Math.ceil(bbox.e / q) * q,
  };
}

async function getPois(bbox) {
  const qb = quantizeBbox(bbox);
  const key = `pois_${qb.s.toFixed(1)}_${qb.w.toFixed(1)}_${qb.n.toFixed(1)}_${qb.e.toFixed(1)}.json`;
  const file = path.join(CACHE_DIR, key);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < TILE_TTL_MS) {
      return JSON.parse(await fs.readFile(file, "utf8"));
    }
  } catch { /* Cache-Miss */ }

  try {
    const elements = await overpass(buildBboxQuery(qb), `POI-Tile ${key}`);
    const { pois } = parseElements(elements);
    // Regionale POIs (Hofladen/Markt/Imkerei) kommen aus dem Deutschland-
    // Datenbestand; hier nur die übrigen Frequenzbringer behalten.
    const filtered = pois.filter((p) => p.cat !== "regional");
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(filtered));
    return filtered;
  } catch (e) {
    // Overpass nicht erreichbar: lieber veralteter Cache als gar nichts
    log("POI-Tile-Abruf fehlgeschlagen (" + e.message + ") – nutze Cache/leer");
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return [];
    }
  }
}

// ---------- HTTP-Server ----------

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end(); return;
  }
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  try {
    if (p === "/api/status") {
      return sendJson(res, 200, {
        mode: "server",
        updatedAt: germany.updatedAt,
        updateRunning,
        machines: germany.machines.length,
        regionalPois: germany.regionalPois.length,
        population: germany.population.length,
        updateIntervalHours: UPDATE_INTERVAL_H,
      });
    }

    if (p === "/api/machines" || p === "/api/population" || p === "/api/pois") {
      const bbox = parseBboxParam(url.searchParams.get("bbox"));
      if (!bbox) return sendJson(res, 400, { error: "Parameter bbox=s,w,n,e fehlt oder ungültig" });
      if (bbox.n - bbox.s > 3 || bbox.e - bbox.w > 4) {
        return sendJson(res, 400, { error: "bbox zu groß – bitte hineinzoomen" });
      }
      if (p === "/api/machines") {
        return sendJson(res, 200, germany.machines.filter((m) => inBbox(m, bbox)));
      }
      if (p === "/api/population") {
        return sendJson(res, 200, germany.population.filter((x) => inBbox(x, bbox)));
      }
      // /api/pois: Tile-Cache + regionale POIs aus dem Deutschland-Bestand
      const pois = await getPois(bbox);
      const regional = germany.regionalPois.filter((x) => inBbox(x, bbox));
      return sendJson(res, 200, [...pois, ...regional]);
    }

    if (p === "/api/refresh" && req.method === "POST") {
      if (updateRunning) return sendJson(res, 202, { status: "läuft bereits" });
      updateGermany(); // bewusst nicht awaiten – dauert Minuten
      return sendJson(res, 202, { status: "Update gestartet" });
    }

    if (p.startsWith("/api/")) return sendJson(res, 404, { error: "Unbekannter Endpunkt" });

    return await serveStatic(req, res, p);
  } catch (e) {
    log("Fehler bei " + p + ": " + e.message);
    return sendJson(res, 500, { error: e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadGermany();
  scheduleUpdates();
  server.listen(PORT, HOST, () => {
    log(`Standort-Analyse Deutschland läuft auf http://${HOST}:${PORT}`);
    log(`Datenverzeichnis: ${DATA_DIR} · Update-Intervall: ${UPDATE_INTERVAL_H} h`);
  });
}

export { server, loadGermany };
