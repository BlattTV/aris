/**
 * White-Label-Branchenprofile: dasselbe Frequenz-/Gravitationsmodell trägt
 * jedes standortbasierte Geschäft. Ein Profil ändert Begriffe und liefert
 * kalibrierte Default-Parameter für das Geschäftsmodell.
 */
import { state, updateSettings } from "./store.js";

export const VERTICALS = {
  automaten: {
    label: "Verkaufsautomaten",
    unit: "Automat", unitPlural: "Automaten",
    defaults: { captureRatePct: 0.4, avgTicketEur: 3.5, marginPct: 45, opexPerMachineMonth: 180, residentBuysPerYear: 13 },
  },
  foodtruck: {
    label: "Foodtrucks",
    unit: "Stellplatz", unitPlural: "Stellplätze",
    defaults: { captureRatePct: 2.5, avgTicketEur: 12, marginPct: 35, opexPerMachineMonth: 900, residentBuysPerYear: 8 },
  },
  popup: {
    label: "Pop-up-Retail",
    unit: "Fläche", unitPlural: "Flächen",
    defaults: { captureRatePct: 3.0, avgTicketEur: 25, marginPct: 50, opexPerMachineMonth: 2500, residentBuysPerYear: 3 },
  },
  werbung: {
    label: "Werbeflächen",
    unit: "Werbefläche", unitPlural: "Werbeflächen",
    // "Kunde" = Sichtkontakt, Ticket = TKP/1000 → 0,005 €/Kontakt
    defaults: { captureRatePct: 60, avgTicketEur: 0.005, marginPct: 80, opexPerMachineMonth: 120, residentBuysPerYear: 200 },
  },
  ladesaeule: {
    label: "E-Ladesäulen",
    unit: "Ladepunkt", unitPlural: "Ladepunkte",
    defaults: { captureRatePct: 0.4, avgTicketEur: 14, marginPct: 30, opexPerMachineMonth: 350, residentBuysPerYear: 12 },
  },
};

export function currentVertical() {
  return VERTICALS[state.settings.vertical] || VERTICALS.automaten;
}

export function unit() { return currentVertical().unit; }

/** Profil wechseln; optional die Branchen-Defaults übernehmen. */
export function applyVertical(key, applyDefaults) {
  const v = VERTICALS[key];
  if (!v) return;
  updateSettings({ vertical: key, ...(applyDefaults ? v.defaults : {}) });
  updateVerticalLabels();
}

/** Statische Beschriftungen in der Oberfläche an das Profil anpassen. */
export function updateVerticalLabels() {
  const v = currentVertical();
  document.querySelectorAll("[data-term=unit]").forEach((el) => { el.textContent = v.unit; });
  document.querySelectorAll("[data-term=units]").forEach((el) => { el.textContent = v.unitPlural; });
  const sub = document.querySelector(".brand small");
  if (sub) sub.textContent = `Business Intelligence · ${v.label}`;
}
