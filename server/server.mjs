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
  buildGermanyPoisQuery, buildGermanyPopulationQuery,
  parseElements, inBbox, parseBboxParam,
} from "../js/queries.mjs";
import { initAuth, handleAuthRoute, getUser, licenseState } from "./auth.mjs";
import { initPortfolio, handlePortfolioRoute } from "./portfolio.mjs";
import { initPayments, handlePaymentRoute, paymentsEnabled } from "./payments.mjs";
import { loadZensus, zensusAvailable, queryZensus } from "./zensus.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const GERMANY_FILE = path.join(DATA_DIR, "germany.json");
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const UPDATE_INTERVAL_H = Number(process.env.UPDATE_INTERVAL_H) || 24;
const TILE_TTL_MS = 24 * 60 * 60 * 1000;
// Lizenz-Pflicht für die Daten-API (REQUIRE_AUTH=0 zum Deaktivieren, z. B. Demo)
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== "0";
// White-Label: Instanz-Name (erscheint in Titel & Kopfzeile der App)
const BRAND_NAME = process.env.BRAND_NAME || "";

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

let germany = { updatedAt: null, machines: [], regionalPois: [], pois: [], population: [] };
let updateRunning = false;

async function loadGermany() {
  try {
    germany = JSON.parse(await fs.readFile(GERMANY_FILE, "utf8"));
    germany.pois = germany.pois || []; // ältere Datenbestände kennen das Feld nicht
    log(`Deutschland-Datenbestand geladen: ${germany.machines.length} Automaten, ` +
        `${germany.regionalPois.length} Hofläden/Märkte, ${germany.pois.length} Attraktionen, ` +
        `${germany.population.length} Orte (Stand ${germany.updatedAt})`);
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

/**
 * Nächtliches Komplett-Update: ganz Deutschland (dauert einige Minuten).
 * Drei Teil-Abfragen (farmshops-Modell, Attraktionen, Bevölkerung) laufen
 * unabhängig: schlägt eine fehl, bleibt deren alter Bestand erhalten.
 * Plausibilitätsschutz: ein verdächtig leeres Ergebnis überschreibt nie
 * einen vorhandenen guten Datenbestand.
 */
export async function updateGermany() {
  if (updateRunning) {
    log("Update läuft bereits – übersprungen.");
    return false;
  }
  updateRunning = true;
  try {
    const next = { ...germany };
    let okParts = 0;

    try {
      const parsed = parseElements(await overpass(
        buildGermanyFarmshopsQuery(), "farmshops-Datenmodell Deutschland"));
      if (parsed.machines.length < 100 && germany.machines.length > 1000) {
        throw new Error("verdächtig wenig Automaten erhalten");
      }
      next.machines = parsed.machines;
      next.regionalPois = parsed.pois; // shop=farm, marketplace, beekeeper
      okParts++;
    } catch (e) {
      log("⚠️ Teil-Update farmshops fehlgeschlagen: " + e.message);
    }

    try {
      const parsed = parseElements(await overpass(
        buildGermanyPoisQuery(), "Attraktionen Deutschland"));
      if (parsed.pois.length < 500 && (germany.pois?.length || 0) > 5000) {
        throw new Error("verdächtig wenige Attraktionen erhalten");
      }
      next.pois = parsed.pois;
      okParts++;
    } catch (e) {
      log("⚠️ Teil-Update Attraktionen fehlgeschlagen: " + e.message);
    }

    try {
      const population = parseElements(await overpass(
        buildGermanyPopulationQuery(), "Bevölkerung Deutschland")).population;
      if (population.length < 500 && germany.population.length > 5000) {
        throw new Error("verdächtig wenige Orte erhalten");
      }
      next.population = population;
      okParts++;
    } catch (e) {
      log("⚠️ Teil-Update Bevölkerung fehlgeschlagen: " + e.message);
    }

    if (!okParts) throw new Error("alle Teil-Abfragen fehlgeschlagen");

    next.updatedAt = new Date().toISOString();
    germany = next;
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = GERMANY_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(germany));
    await fs.rename(tmp, GERMANY_FILE);
    log(`✅ Deutschland-Update fertig (${okParts}/3 Teile): ${germany.machines.length} Automaten, ` +
        `${germany.regionalPois.length} Hofläden/Märkte, ${germany.pois.length} Attraktionen, ` +
        `${germany.population.length} Orte`);
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
    // Altbestand aus einer Version ohne Attraktions-Sync → sofort nachladen
    if (germany.machines.length && !(germany.pois?.length)) return true;
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

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

/** Rohen Request-Body lesen (für Webhook-Signaturen). */
function readRaw(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("Anfrage zu groß"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** JSON-Body lesen. */
async function readJson(req, limit = 65536) {
  const raw = await readRaw(req, limit);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Ungültiges JSON"), { status: 400 });
  }
}

// Nur die Web-App ausliefern – niemals Serverdaten, Code-Interna oder Git
const STATIC_DENY = ["/data/", "/server/", "/deploy/", "/android/", "/node_modules/"];

async function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  const lower = pathname.toLowerCase();
  if (
    STATIC_DENY.some((d) => lower.startsWith(d)) ||
    pathname.split("/").some((seg) => seg.startsWith("."))
  ) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
    return;
  }
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
        authRequired: REQUIRE_AUTH,
        brand: BRAND_NAME || null,
        payments: paymentsEnabled(),
        zensus: zensusAvailable(),
        updatedAt: germany.updatedAt,
        updateRunning,
        machines: germany.machines.length,
        regionalPois: germany.regionalPois.length,
        pois: germany.pois?.length || 0,
        population: germany.population.length,
        updateIntervalHours: UPDATE_INTERVAL_H,
      });
    }

    // Zahlungen: Webhook braucht den ROHEN Body (Stripe-Signatur)
    if (p.startsWith("/api/payments/")) {
      const raw = req.method === "POST" ? await readRaw(req, 262144) : "";
      const result = await handlePaymentRoute(p, req, raw, log);
      if (result) return sendJson(res, result.status, result.body);
      return sendJson(res, 404, { error: "Unbekannter Endpunkt" });
    }

    // Portfolio-Sync, Team-Freigaben, Telemetrie
    if (p.startsWith("/api/portfolio") || p === "/api/telemetry") {
      const body = ["POST", "PUT"].includes(req.method)
        ? await readJson(req, 2.5 * 1024 * 1024)
        : {};
      const result = await handlePortfolioRoute(p, req, body);
      if (result) return sendJson(res, result.status, result.body);
      return sendJson(res, 404, { error: "Unbekannter Endpunkt" });
    }

    // Auth-/Admin-Routen (Login, Registrierung, Lizenzverwaltung …)
    if (p.startsWith("/api/auth/") || p.startsWith("/api/admin/")) {
      const body = req.method === "POST" ? await readJson(req) : {};
      const result = await handleAuthRoute(p, req, body);
      if (result) return sendJson(res, result.status, result.body, result.headers);
      return sendJson(res, 404, { error: "Unbekannter Endpunkt" });
    }

    // Daten-API: nur mit gültiger Lizenz (Admin immer)
    if (REQUIRE_AUTH && (p === "/api/machines" || p === "/api/population" ||
        p === "/api/pois" || p === "/api/refresh")) {
      const user = getUser(req);
      if (!user) return sendJson(res, 401, { error: "Nicht angemeldet" });
      const lic = licenseState(user);
      if (!lic.valid) return sendJson(res, 403, { error: "Keine gültige Lizenz: " + lic.reason });
      if (p === "/api/refresh" && user.role !== "admin") {
        return sendJson(res, 403, { error: "Deutschland-Update kann nur der Admin anstoßen" });
      }
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
        // Zensus-Raster (falls importiert) ist präziser als place-Nodes
        if (zensusAvailable()) {
          const cells = queryZensus(bbox);
          if (cells && cells.length) return sendJson(res, 200, cells);
        }
        return sendJson(res, 200, germany.population.filter((x) => inBbox(x, bbox)));
      }
      // /api/pois: Attraktionen aus dem nächtlich synchronisierten
      // Deutschland-Bestand (sonst Tile-Cache) + regionale POIs
      const pois = germany.pois?.length
        ? germany.pois.filter((x) => inBbox(x, bbox))
        : await getPois(bbox);
      const regional = germany.regionalPois.filter((x) => inBbox(x, bbox));
      let combined = [...pois, ...regional];
      // Deckelung für Ballungsräume: die besucherstärksten zuerst
      if (combined.length > 6000) {
        combined.sort((a, b) => b.visitors - a.visitors);
        combined = combined.slice(0, 6000);
      }
      return sendJson(res, 200, combined);
    }

    if (p === "/api/refresh" && req.method === "POST") {
      if (updateRunning) return sendJson(res, 202, { status: "läuft bereits" });
      updateGermany(); // bewusst nicht awaiten – dauert Minuten
      return sendJson(res, 202, { status: "Update gestartet" });
    }

    if (p.startsWith("/api/")) return sendJson(res, 404, { error: "Unbekannter Endpunkt" });

    return await serveStatic(req, res, p);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log("Fehler bei " + p + ": " + e.message);
    return sendJson(res, status, { error: e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadGermany();
  await initAuth(DATA_DIR, log);
  initPortfolio(DATA_DIR);
  initPayments(DATA_DIR);
  await loadZensus(DATA_DIR, log);
  if (!REQUIRE_AUTH) log("⚠️ REQUIRE_AUTH=0 – Daten-API läuft ohne Lizenzprüfung!");
  if (!paymentsEnabled()) log("Hinweis: STRIPE_SECRET_KEY nicht gesetzt – Lizenzverkauf per Zahlung deaktiviert.");
  scheduleUpdates();
  server.listen(PORT, HOST, () => {
    log(`Standort-Analyse Deutschland läuft auf http://${HOST}:${PORT}`);
    log(`Datenverzeichnis: ${DATA_DIR} · Update-Intervall: ${UPDATE_INTERVAL_H} h`);
  });
}

export { server, loadGermany };
