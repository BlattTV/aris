/**
 * Zahlungsanbindung (Stripe Checkout) für automatischen Lizenzverkauf –
 * ohne SDK, direkt über die Stripe-REST-API.
 *
 * Ablauf: Kunde wählt in der App einen Plan → Server erzeugt eine
 * Stripe-Checkout-Session → Kunde zahlt bei Stripe → Stripe ruft den
 * Webhook auf → Server schreibt die Lizenz direkt auf das Konto gut.
 *
 * Konfiguration (Umgebungsvariablen):
 *   STRIPE_SECRET_KEY      sk_live_… / sk_test_…  (ohne Key: Verkauf deaktiviert)
 *   STRIPE_WEBHOOK_SECRET  whsec_… (Signaturprüfung des Webhooks)
 *   PUBLIC_URL             öffentliche Basis-URL der Instanz (für Redirects)
 *   PLANS_JSON             optional eigene Pläne als JSON-Array
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getUser, grantLicense, licenseState } from "./auth.mjs";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

const DEFAULT_PLANS = [
  { id: "standard-30", label: "Standard – 30 Tage", plan: "standard", days: 30, eur: 14.9 },
  { id: "standard-365", label: "Standard – 1 Jahr", plan: "standard", days: 365, eur: 119 },
  { id: "pro-365", label: "Pro – 1 Jahr", plan: "pro", days: 365, eur: 249 },
];

function plans() {
  try {
    return process.env.PLANS_JSON ? JSON.parse(process.env.PLANS_JSON) : DEFAULT_PLANS;
  } catch {
    return DEFAULT_PLANS;
  }
}

export const paymentsEnabled = () => !!STRIPE_KEY;

let dataDir = "./data";
export function initPayments(d) {
  dataDir = d;
}

async function recordPayment(entry) {
  const f = path.join(dataDir, "payments.json");
  let list = [];
  try { list = JSON.parse(await fs.readFile(f, "utf8")); } catch { /* neu */ }
  list.push(entry);
  await fs.writeFile(f + ".tmp", JSON.stringify(list, null, 1));
  await fs.rename(f + ".tmp", f);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function stripeApi(endpoint, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch("https://api.stripe.com/v1/" + endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + STRIPE_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw httpError(502, "Stripe: " + (json.error?.message || res.status));
  return json;
}

/** Stripe-Webhook-Signatur prüfen (Stripe-Signature: t=…,v1=…). */
export function verifyStripeSignature(rawBody, header, secret = WEBHOOK_SECRET) {
  if (!secret) return false;
  const parts = Object.fromEntries(
    String(header || "").split(",").map((kv) => kv.split("=").map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return false;
  // Replay-Schutz: Signaturen älter als 5 Minuten ablehnen
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

/**
 * Bearbeitet /api/payments/*-Routen.
 * Für den Webhook wird der ROHE Body benötigt (Signatur!), daher
 * bekommt diese Funktion rawBody statt geparstem JSON.
 */
export async function handlePaymentRoute(p, req, rawBody, log) {
  if (!p.startsWith("/api/payments/")) return null;

  if (p === "/api/payments/plans") {
    return { status: 200, body: { enabled: paymentsEnabled(), plans: plans() } };
  }

  if (p === "/api/payments/checkout" && req.method === "POST") {
    if (!paymentsEnabled()) throw httpError(503, "Zahlung nicht konfiguriert (STRIPE_SECRET_KEY fehlt)");
    const user = getUser(req);
    if (!user) throw httpError(401, "Nicht angemeldet");
    const body = JSON.parse(rawBody || "{}");
    const plan = plans().find((x) => x.id === body.planId);
    if (!plan) throw httpError(400, "Unbekannter Plan");
    const base = PUBLIC_URL || `http://${req.headers.host}`;
    const session = await stripeApi("checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(Math.round(plan.eur * 100)),
      "line_items[0][price_data][product_data][name]": `Standort-Analyse Lizenz: ${plan.label}`,
      success_url: base + "/?payment=success",
      cancel_url: base + "/?payment=cancel",
      customer_email: user.email,
      "metadata[userId]": user.id,
      "metadata[planId]": plan.id,
    });
    return { status: 200, body: { url: session.url } };
  }

  if (p === "/api/payments/webhook" && req.method === "POST") {
    if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"])) {
      throw httpError(400, "Ungültige Webhook-Signatur");
    }
    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const plan = plans().find((x) => x.id === s.metadata?.planId);
      if (plan && s.metadata?.userId && s.payment_status === "paid") {
        await grantLicense(s.metadata.userId, plan.plan, plan.days,
          `Stripe ${s.id} (${plan.label})`);
        await recordPayment({
          at: new Date().toISOString(),
          userId: s.metadata.userId,
          planId: plan.id,
          eur: plan.eur,
          stripeSession: s.id,
        });
        log(`💰 Zahlung verbucht: ${plan.label} für Nutzer ${s.metadata.userId}`);
      }
    }
    return { status: 200, body: { received: true } };
  }

  if (p === "/api/payments/history") {
    const user = getUser(req);
    if (!user || user.role !== "admin") throw httpError(403, "Nur für Administratoren");
    let list = [];
    try {
      list = JSON.parse(await fs.readFile(path.join(dataDir, "payments.json"), "utf8"));
    } catch { /* keine Zahlungen */ }
    return { status: 200, body: list };
  }

  return null;
}

export { licenseState };
