/**
 * Portfolio-Sync je Konto, Team-Freigaben und Automaten-Telemetrie.
 *
 * Jedes Konto hat genau ein Portfolio (Automaten, eigene Orte, Events,
 * Einstellungen) als JSON-Dokument mit updatedAt (Last-Write-Wins).
 * Freigaben: Der Eigentümer teilt sein Portfolio lesend mit anderen
 * Konten (per E-Mail); Empfänger sehen die Standorte des Teams.
 * Telemetrie: Automaten melden Umsätze per API-Token (X-Api-Key) –
 * Grundlage für Kalibrierung und Forecasting.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getUser, getUserByApiToken, getUserByEmail, getUserById } from "./auth.mjs";

const MAX_PORTFOLIO_BYTES = 2 * 1024 * 1024;

let dataDir = "./data";
const dir = () => path.join(dataDir, "portfolios");
const file = (userId) => path.join(dir(), userId.replace(/[^a-z0-9-]/gi, "") + ".json");

export function initPortfolio(d) {
  dataDir = d;
}

async function readPortfolio(userId) {
  try {
    return JSON.parse(await fs.readFile(file(userId), "utf8"));
  } catch {
    return { updatedAt: null, data: null, sharedWith: [] };
  }
}

async function writePortfolio(userId, doc) {
  await fs.mkdir(dir(), { recursive: true });
  const f = file(userId);
  await fs.writeFile(f + ".tmp", JSON.stringify(doc));
  await fs.rename(f + ".tmp", f);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function requireUser(req) {
  const user = getUser(req);
  if (!user) throw httpError(401, "Nicht angemeldet");
  return user;
}

/**
 * Bearbeitet /api/portfolio*- und /api/telemetry-Routen.
 * @returns {object|null} {status, body} oder null wenn nicht zuständig
 */
export async function handlePortfolioRoute(p, req, body) {
  // --- Telemetrie (API-Token statt Session, für Automaten-Hardware) ---
  if (p === "/api/telemetry" && req.method === "POST") {
    const user = getUserByApiToken(req.headers["x-api-key"]);
    if (!user) throw httpError(401, "Ungültiger API-Token (Header X-Api-Key)");
    const machineId = String(body.machineId || "");
    const month = String(body.month || new Date().toISOString().slice(0, 7));
    const eur = Number(body.eur);
    if (!machineId || !/^\d{4}-\d{2}$/.test(month) || !isFinite(eur)) {
      throw httpError(400, "machineId, month (YYYY-MM) und eur erforderlich");
    }
    const doc = await readPortfolio(user.id);
    if (!doc.data) throw httpError(409, "Noch kein Portfolio synchronisiert");
    const machine = (doc.data.machines || []).find((m) => m.id === machineId);
    if (!machine) throw httpError(404, "Automat unbekannt: " + machineId);
    machine.salesHistory = machine.salesHistory || [];
    const entry = machine.salesHistory.find((h) => h.month === month);
    if (entry) entry.eur = eur;
    else machine.salesHistory.push({ month, eur });
    machine.salesHistory.sort((a, b) => a.month.localeCompare(b.month));
    machine.monthlySalesEur = machine.salesHistory[machine.salesHistory.length - 1].eur;
    doc.updatedAt = new Date().toISOString();
    await writePortfolio(user.id, doc);
    return { status: 200, body: { ok: true, machine: machine.name, month, eur } };
  }

  if (!p.startsWith("/api/portfolio")) return null;
  const user = requireUser(req);

  if (p === "/api/portfolio" && req.method === "GET") {
    const doc = await readPortfolio(user.id);
    return { status: 200, body: doc };
  }

  if (p === "/api/portfolio" && req.method === "PUT") {
    if (JSON.stringify(body.data || {}).length > MAX_PORTFOLIO_BYTES) {
      throw httpError(413, "Portfolio zu groß");
    }
    const doc = await readPortfolio(user.id);
    doc.data = body.data || null;
    doc.updatedAt = new Date().toISOString();
    await writePortfolio(user.id, doc);
    return { status: 200, body: { updatedAt: doc.updatedAt } };
  }

  if (p === "/api/portfolio/share" && req.method === "POST") {
    const target = getUserByEmail(body.email);
    if (!target) throw httpError(404, "Kein Konto mit dieser E-Mail");
    if (target.id === user.id) throw httpError(400, "Eigenes Portfolio muss nicht geteilt werden");
    const doc = await readPortfolio(user.id);
    doc.sharedWith = doc.sharedWith || [];
    if (!doc.sharedWith.some((s) => s.userId === target.id)) {
      doc.sharedWith.push({ userId: target.id, email: target.email, since: new Date().toISOString() });
      await writePortfolio(user.id, doc);
    }
    return { status: 200, body: { sharedWith: doc.sharedWith } };
  }

  if (p === "/api/portfolio/unshare" && req.method === "POST") {
    const doc = await readPortfolio(user.id);
    doc.sharedWith = (doc.sharedWith || []).filter((s) => s.email !== String(body.email || "").toLowerCase());
    await writePortfolio(user.id, doc);
    return { status: 200, body: { sharedWith: doc.sharedWith } };
  }

  if (p === "/api/portfolio/shared" && req.method === "GET") {
    // Alle Portfolios, die mit mir geteilt wurden (lesend)
    const out = [];
    try {
      for (const f of await fs.readdir(dir())) {
        if (!f.endsWith(".json")) continue;
        const ownerId = f.slice(0, -5);
        if (ownerId === user.id) continue;
        const doc = await readPortfolio(ownerId);
        if ((doc.sharedWith || []).some((s) => s.userId === user.id)) {
          const owner = getUserById(ownerId);
          out.push({
            owner: { email: owner?.email || "?", name: owner?.name || "?" },
            updatedAt: doc.updatedAt,
            machines: doc.data?.machines || [],
          });
        }
      }
    } catch { /* noch keine Portfolios */ }
    return { status: 200, body: out };
  }

  return null;
}
