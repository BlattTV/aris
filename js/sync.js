/**
 * Portfolio-Sync: hält das Nutzer-Portfolio (Automaten, Orte, Events,
 * Einstellungen) serverseitig je Konto aktuell – Mehrgeräte-Sync per
 * Last-Write-Wins, entprellter Push nach jeder lokalen Änderung.
 */
import { state, buildPortfolioDoc, applyPortfolioDoc, setPersistHook, notify } from "./store.js";

const SYNC_META_KEY = "coburg-analyzer-v1-sync";

let active = false;
let pushTimer = null;

function meta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}; } catch { return {}; }
}

function setMeta(m) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(m));
}

async function push() {
  if (!active) return;
  try {
    const res = await fetch("api/portfolio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: buildPortfolioDoc() }),
    });
    if (res.ok) {
      const { updatedAt } = await res.json();
      setMeta({ serverUpdatedAt: updatedAt });
      notify("sync:done");
    }
  } catch (e) {
    console.warn("Portfolio-Push fehlgeschlagen:", e);
  }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 2000);
}

/**
 * Nach erfolgreichem Login aufrufen: Server-Stand holen, Konflikt per
 * Last-Write-Wins auflösen, danach automatisch synchron halten.
 */
export async function initSync() {
  try {
    const res = await fetch("api/portfolio");
    if (!res.ok) return;
    const doc = await res.json();
    const known = meta().serverUpdatedAt || null;
    if (doc.data && doc.updatedAt && doc.updatedAt !== known) {
      // Server hat einen Stand, den dieses Gerät nicht kennt → übernehmen
      applyPortfolioDoc(doc.data);
      setMeta({ serverUpdatedAt: doc.updatedAt });
    } else {
      // Lokaler Stand ist aktuell(er) → hochladen
      await push();
    }
    active = true;
    setPersistHook(schedulePush);
    notify("sync:ready");
  } catch (e) {
    console.warn("Portfolio-Sync nicht verfügbar:", e);
  }
}

export function stopSync() {
  active = false;
  setPersistHook(null);
}

export const syncActive = () => active;

// ---------- Team-Freigaben ----------

export async function shareWith(email) {
  const res = await fetch("api/portfolio/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Freigabe fehlgeschlagen");
  return data.sharedWith;
}

export async function unshareWith(email) {
  const res = await fetch("api/portfolio/unshare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return (await res.json()).sharedWith;
}

export async function mySharedWith() {
  try {
    const res = await fetch("api/portfolio");
    if (!res.ok) return [];
    return (await res.json()).sharedWith || [];
  } catch { return []; }
}

/** Mit mir geteilte Portfolios laden → Team-Standorte auf der Karte. */
export async function loadTeamMachines() {
  try {
    const res = await fetch("api/portfolio/shared");
    if (!res.ok) return 0;
    const shared = await res.json();
    state.teamMachines = shared.flatMap((s) =>
      (s.machines || []).filter((m) => !m.isCompetitor).map((m) => ({
        ...m,
        owner: s.owner.email,
        team: true,
      }))
    );
    notify("team");
    return state.teamMachines.length;
  } catch { return 0; }
}
