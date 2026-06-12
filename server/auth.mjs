/**
 * Account-, Lizenz- und Session-Verwaltung (ohne Abhängigkeiten).
 *
 * Geschäftsmodell: Der Admin erzeugt Lizenzschlüssel (Plan + Laufzeit) und
 * verkauft sie. Ein Kunde registriert sich mit einem Schlüssel oder löst
 * ihn später ein; der Schlüssel verlängert die Gültigkeit des Zugangs.
 * Ohne gültige Lizenz liefert die Daten-API 401/403.
 *
 * Persistenz: JSON-Dateien im DATA_DIR (users.json, licenses.json,
 * sessions.json), atomar geschrieben. Passwörter: scrypt + Salt.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const COOKIE_NAME = "sa_session";

let dataDir = "./data";
let users = [];      // {id,email,name,passwordHash,role,licensePlan,licenseValidUntil,active,createdAt,lastLoginAt}
let licenses = [];   // {key,plan,durationDays,note,createdAt,usedBy,usedAt,revoked}
let sessions = {};   // token -> {userId, expires}

const file = (name) => path.join(dataDir, name);

async function saveJson(name, data) {
  await fs.mkdir(dataDir, { recursive: true });
  const f = file(name);
  await fs.writeFile(f + ".tmp", JSON.stringify(data, null, 1));
  await fs.rename(f + ".tmp", f);
}

async function loadJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

const saveUsers = () => saveJson("users.json", users);
const saveLicenses = () => saveJson("licenses.json", licenses);
const saveSessions = () => saveJson("sessions.json", sessions);

// ---------- Passwörter ----------

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

// ---------- Initialisierung & Admin-Bootstrap ----------

export async function initAuth(dir, log) {
  dataDir = dir;
  users = await loadJson("users.json", []);
  licenses = await loadJson("licenses.json", []);
  sessions = await loadJson("sessions.json", {});
  // Korrupte Dateien dürfen den Start nicht verhindern
  if (!Array.isArray(users)) users = [];
  if (!Array.isArray(licenses)) licenses = [];
  if (typeof sessions !== "object" || !sessions) sessions = {};

  // abgelaufene Sessions entsorgen
  const now = Date.now();
  for (const [t, s] of Object.entries(sessions)) {
    if (s.expires < now) delete sessions[t];
  }

  if (!users.some((u) => u.role === "admin")) {
    const email = process.env.ADMIN_EMAIL || "admin@standort-analyse.local";
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
    users.push({
      id: "u-" + crypto.randomBytes(6).toString("hex"),
      email: email.toLowerCase(),
      name: "Administrator",
      passwordHash: hashPassword(password),
      role: "admin",
      licensePlan: "admin",
      licenseValidUntil: null,
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    await saveUsers();
    log("════════════════════════════════════════════════════");
    log("  ERSTER START – Admin-Konto angelegt:");
    log(`  E-Mail:   ${email}`);
    log(`  Passwort: ${process.env.ADMIN_PASSWORD ? "(aus ADMIN_PASSWORD)" : password}`);
    log("  Bitte nach dem ersten Login ändern (Admin-Oberfläche).");
    log("════════════════════════════════════════════════════");
  }
}

// ---------- Sessions / Cookies ----------

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeMs = SESSION_TTL_MS) {
  // Kein "Secure"-Flag: LXC-Betrieb im LAN läuft typischerweise über http.
  // Hinter einem HTTPS-Reverse-Proxy ggf. ergänzen.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions[token] = { userId, expires: Date.now() + SESSION_TTL_MS };
  await saveSessions();
  return token;
}

export async function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token && sessions[token]) {
    delete sessions[token];
    await saveSessions();
  }
}

/** Liefert den angemeldeten Nutzer oder null. */
export function getUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  const s = token && sessions[token];
  if (!s || s.expires < Date.now()) return null;
  const user = users.find((u) => u.id === s.userId);
  return user && user.active ? user : null;
}

// ---------- Lizenzen ----------

export function generateLicenseKey() {
  const block = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `SA-${block()}-${block()}-${block()}-${block()}`;
}

export function licenseState(user) {
  if (!user) return { valid: false, reason: "nicht angemeldet" };
  if (user.role === "admin") return { valid: true, plan: "admin", validUntil: null };
  if (!user.active) return { valid: false, reason: "Konto deaktiviert" };
  if (!user.licenseValidUntil) return { valid: false, reason: "keine Lizenz" };
  const valid = Date.parse(user.licenseValidUntil) > Date.now();
  return {
    valid,
    plan: user.licensePlan,
    validUntil: user.licenseValidUntil,
    reason: valid ? null : "Lizenz abgelaufen",
  };
}

/** Schlüssel einlösen: verlängert die Lizenz des Nutzers. */
async function redeemKey(user, key) {
  const lic = licenses.find((l) => l.key === String(key).trim().toUpperCase());
  if (!lic) throw httpError(400, "Lizenzschlüssel unbekannt");
  if (lic.revoked) throw httpError(400, "Lizenzschlüssel wurde widerrufen");
  if (lic.usedBy) throw httpError(400, "Lizenzschlüssel wurde bereits eingelöst");

  const base = user.licenseValidUntil && Date.parse(user.licenseValidUntil) > Date.now()
    ? Date.parse(user.licenseValidUntil)
    : Date.now();
  user.licenseValidUntil = new Date(base + lic.durationDays * 86400000).toISOString();
  user.licensePlan = lic.plan;
  lic.usedBy = user.id;
  lic.usedAt = new Date().toISOString();
  await saveUsers();
  await saveLicenses();
  return lic;
}

/**
 * Lizenz direkt vergeben (z. B. nach Zahlungseingang): verlängert den
 * Nutzer und legt zur Buchführung einen bereits eingelösten Schlüssel an.
 */
export async function grantLicense(userId, plan, durationDays, note) {
  const user = users.find((u) => u.id === userId);
  if (!user) throw httpError(404, "Nutzer unbekannt");
  const base = user.licenseValidUntil && Date.parse(user.licenseValidUntil) > Date.now()
    ? Date.parse(user.licenseValidUntil)
    : Date.now();
  user.licenseValidUntil = new Date(base + durationDays * 86400000).toISOString();
  user.licensePlan = plan;
  licenses.push({
    key: generateLicenseKey(), plan, durationDays, note: note || "automatisch (Zahlung)",
    createdAt: new Date().toISOString(),
    usedBy: user.id, usedAt: new Date().toISOString(), revoked: false,
  });
  await saveUsers();
  await saveLicenses();
  return user;
}

/** Nutzer anhand seines Telemetrie-API-Tokens finden. */
export function getUserByApiToken(token) {
  if (!token) return null;
  const user = users.find((u) => u.apiToken && u.apiToken === token);
  return user && user.active ? user : null;
}

/** Nutzer per ID (für Portfolio-Freigaben). */
export function getUserById(id) {
  return users.find((u) => u.id === id) || null;
}

export function getUserByEmail(email) {
  return users.find((u) => u.email === String(email || "").toLowerCase().trim()) || null;
}

async function rotateApiToken(user) {
  user.apiToken = "sat_" + crypto.randomBytes(24).toString("hex");
  await saveUsers();
  return user.apiToken;
}

// ---------- Hilfen ----------

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function publicUser(u) {
  const lic = licenseState(u);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    license: lic, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    active: u.active,
  };
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

// einfacher Login-Rate-Limiter je IP
const attempts = new Map();
function checkRate(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { count: 0, reset: now + 60000 };
  if (now > a.reset) { a.count = 0; a.reset = now + 60000; }
  a.count++;
  attempts.set(ip, a);
  if (a.count > 8) throw httpError(429, "Zu viele Versuche – bitte 1 Minute warten");
}

// ---------- Route-Handler (von server.mjs aufgerufen) ----------

/**
 * Bearbeitet /api/auth/*- und /api/admin/*-Routen.
 * @returns {object|null} JSON-Antwort {status, body, headers?} oder null wenn nicht zuständig
 */
export async function handleAuthRoute(p, req, body) {
  const ip = req.socket.remoteAddress || "?";

  if (p === "/api/auth/login" && req.method === "POST") {
    checkRate(ip);
    const user = users.find((u) => u.email === String(body.email || "").toLowerCase().trim());
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      throw httpError(401, "E-Mail oder Passwort falsch");
    }
    if (!user.active) throw httpError(403, "Konto deaktiviert");
    user.lastLoginAt = new Date().toISOString();
    await saveUsers();
    const token = await createSession(user.id);
    return { status: 200, body: publicUser(user), headers: { "Set-Cookie": sessionCookie(token) } };
  }

  if (p === "/api/auth/register" && req.method === "POST") {
    checkRate(ip);
    const email = String(body.email || "").toLowerCase().trim();
    if (!isEmail(email)) throw httpError(400, "Gültige E-Mail-Adresse angeben");
    if (String(body.password || "").length < 8) throw httpError(400, "Passwort: mindestens 8 Zeichen");
    if (!body.licenseKey) throw httpError(400, "Registrierung nur mit Lizenzschlüssel möglich");
    if (users.some((u) => u.email === email)) throw httpError(409, "E-Mail bereits registriert");

    const user = {
      id: "u-" + crypto.randomBytes(6).toString("hex"),
      email,
      name: String(body.name || "").slice(0, 80) || email.split("@")[0],
      passwordHash: hashPassword(String(body.password)),
      role: "user",
      licensePlan: null,
      licenseValidUntil: null,
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    await redeemKey(user, body.licenseKey); // wirft bei ungültigem Schlüssel – Nutzer wird dann nicht angelegt
    users.push(user);
    await saveUsers();
    const token = await createSession(user.id);
    return { status: 201, body: publicUser(user), headers: { "Set-Cookie": sessionCookie(token) } };
  }

  if (p === "/api/auth/logout" && req.method === "POST") {
    await destroySession(req);
    return { status: 200, body: { ok: true }, headers: { "Set-Cookie": clearCookie() } };
  }

  if (p === "/api/auth/me") {
    const user = getUser(req);
    if (!user) throw httpError(401, "Nicht angemeldet");
    return { status: 200, body: publicUser(user) };
  }

  if (p === "/api/auth/redeem" && req.method === "POST") {
    const user = getUser(req);
    if (!user) throw httpError(401, "Nicht angemeldet");
    const lic = await redeemKey(user, body.licenseKey);
    return { status: 200, body: { ...publicUser(user), redeemed: { plan: lic.plan, durationDays: lic.durationDays } } };
  }

  if (p === "/api/auth/token" && req.method === "POST") {
    const user = getUser(req);
    if (!user) throw httpError(401, "Nicht angemeldet");
    const token = await rotateApiToken(user);
    return { status: 200, body: { apiToken: token } };
  }

  if (p === "/api/auth/password" && req.method === "POST") {
    const user = getUser(req);
    if (!user) throw httpError(401, "Nicht angemeldet");
    if (!verifyPassword(String(body.current || ""), user.passwordHash)) {
      throw httpError(403, "Aktuelles Passwort falsch");
    }
    if (String(body.next || "").length < 8) throw httpError(400, "Neues Passwort: mindestens 8 Zeichen");
    user.passwordHash = hashPassword(String(body.next));
    await saveUsers();
    return { status: 200, body: { ok: true } };
  }

  // ---------- Admin ----------
  if (p.startsWith("/api/admin/")) {
    const admin = getUser(req);
    if (!admin) throw httpError(401, "Nicht angemeldet");
    if (admin.role !== "admin") throw httpError(403, "Nur für Administratoren");

    if (p === "/api/admin/overview") {
      const now = Date.now();
      return {
        status: 200,
        body: {
          stats: {
            users: users.length,
            activeLicenses: users.filter((u) => licenseState(u).valid && u.role !== "admin").length,
            expiring7d: users.filter((u) => u.licenseValidUntil &&
              Date.parse(u.licenseValidUntil) > now &&
              Date.parse(u.licenseValidUntil) < now + 7 * 86400000).length,
            unusedKeys: licenses.filter((l) => !l.usedBy && !l.revoked).length,
          },
          users: users.map(publicUser),
          licenses: licenses.map((l) => ({
            ...l,
            usedByEmail: l.usedBy ? users.find((u) => u.id === l.usedBy)?.email : null,
          })),
        },
      };
    }

    if (p === "/api/admin/licenses" && req.method === "POST") {
      const count = Math.min(100, Math.max(1, Number(body.count) || 1));
      const durationDays = Math.max(1, Number(body.durationDays) || 30);
      const plan = String(body.plan || "standard").slice(0, 40);
      const note = String(body.note || "").slice(0, 200);
      const created = [];
      for (let i = 0; i < count; i++) {
        const lic = {
          key: generateLicenseKey(), plan, durationDays, note,
          createdAt: new Date().toISOString(),
          usedBy: null, usedAt: null, revoked: false,
        };
        licenses.push(lic);
        created.push(lic.key);
      }
      await saveLicenses();
      return { status: 201, body: { keys: created } };
    }

    if (p === "/api/admin/licenses/revoke" && req.method === "POST") {
      const lic = licenses.find((l) => l.key === String(body.key || "").toUpperCase());
      if (!lic) throw httpError(404, "Schlüssel unbekannt");
      lic.revoked = true;
      await saveLicenses();
      return { status: 200, body: { ok: true } };
    }

    if (p === "/api/admin/users/create" && req.method === "POST") {
      const email = String(body.email || "").toLowerCase().trim();
      if (!isEmail(email)) throw httpError(400, "Gültige E-Mail-Adresse angeben");
      if (users.some((u) => u.email === email)) throw httpError(409, "E-Mail bereits registriert");
      const password = String(body.password || "") || crypto.randomBytes(9).toString("base64url");
      const durationDays = Number(body.durationDays) || 0;
      const user = {
        id: "u-" + crypto.randomBytes(6).toString("hex"),
        email,
        name: String(body.name || "").slice(0, 80) || email.split("@")[0],
        passwordHash: hashPassword(password),
        role: body.role === "admin" ? "admin" : "user",
        licensePlan: durationDays ? String(body.plan || "standard") : null,
        licenseValidUntil: durationDays ? new Date(Date.now() + durationDays * 86400000).toISOString() : null,
        active: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      users.push(user);
      await saveUsers();
      return { status: 201, body: { ...publicUser(user), initialPassword: body.password ? undefined : password } };
    }

    if (p === "/api/admin/users/update" && req.method === "POST") {
      const user = users.find((u) => u.id === body.id);
      if (!user) throw httpError(404, "Nutzer unbekannt");
      if (typeof body.active === "boolean") {
        if (user.id === admin.id && !body.active) throw httpError(400, "Eigenes Konto kann nicht deaktiviert werden");
        user.active = body.active;
      }
      if (body.role && ["user", "admin"].includes(body.role)) {
        if (user.id === admin.id && body.role !== "admin") throw httpError(400, "Eigene Admin-Rolle kann nicht entzogen werden");
        user.role = body.role;
      }
      if (body.extendDays) {
        const base = user.licenseValidUntil && Date.parse(user.licenseValidUntil) > Date.now()
          ? Date.parse(user.licenseValidUntil) : Date.now();
        user.licenseValidUntil = new Date(base + Number(body.extendDays) * 86400000).toISOString();
        if (!user.licensePlan) user.licensePlan = "standard";
      }
      if (body.password) user.passwordHash = hashPassword(String(body.password));
      await saveUsers();
      return { status: 200, body: publicUser(user) };
    }

    if (p === "/api/admin/users/delete" && req.method === "POST") {
      if (body.id === admin.id) throw httpError(400, "Eigenes Konto kann nicht gelöscht werden");
      const before = users.length;
      users = users.filter((u) => u.id !== body.id);
      if (users.length === before) throw httpError(404, "Nutzer unbekannt");
      for (const [t, s] of Object.entries(sessions)) {
        if (s.userId === body.id) delete sessions[t];
      }
      await saveUsers();
      await saveSessions();
      return { status: 200, body: { ok: true } };
    }
  }

  return null; // Route nicht zuständig
}
