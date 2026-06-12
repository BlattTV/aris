/**
 * Client-Seite des Accountsystems: Login/Registrierung (mit Lizenzschlüssel),
 * Sitzungsstatus, Lizenzanzeige, Logout. Nur im Server-Modus aktiv –
 * statisches Hosting (Direkt-Modus) kennt keine Konten.
 */
import { notify } from "./store.js";

let currentUser = null;

export function getUserInfo() {
  return currentUser;
}

async function call(path, body) {
  const res = await fetch(path, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}

export async function fetchMe() {
  try {
    currentUser = await call("api/auth/me");
  } catch {
    currentUser = null;
  }
  notify("auth");
  return currentUser;
}

export async function login(email, password) {
  currentUser = await call("api/auth/login", { email, password });
  notify("auth");
  return currentUser;
}

export async function registerAccount(fields) {
  currentUser = await call("api/auth/register", fields);
  notify("auth");
  return currentUser;
}

export async function logout() {
  try { await call("api/auth/logout", {}); } catch { /* Sitzung lokal beenden */ }
  currentUser = null;
  notify("auth");
}

export async function redeemLicense(licenseKey) {
  currentUser = await call("api/auth/redeem", { licenseKey });
  notify("auth");
  return currentUser;
}

export async function changePassword(current, next) {
  return call("api/auth/password", { current, next });
}

// ---------- Login-Overlay ----------

const $ = (sel) => document.querySelector(sel);

export function showAuthOverlay() {
  $("#auth-overlay").classList.add("visible");
}

export function hideAuthOverlay() {
  $("#auth-overlay").classList.remove("visible");
}

export function initAuthUi(onLogin) {
  const err = $("#auth-error");
  const setErr = (msg) => { err.textContent = msg || ""; };

  $("#auth-tab-login").addEventListener("click", () => switchTab("login"));
  $("#auth-tab-register").addEventListener("click", () => switchTab("register"));

  function switchTab(tab) {
    setErr("");
    $("#auth-tab-login").classList.toggle("active", tab === "login");
    $("#auth-tab-register").classList.toggle("active", tab === "register");
    $("#auth-form-login").style.display = tab === "login" ? "" : "none";
    $("#auth-form-register").style.display = tab === "register" ? "" : "none";
  }

  $("#auth-form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await login($("#auth-email").value.trim(), $("#auth-password").value);
      hideAuthOverlay();
      onLogin();
    } catch (ex) {
      setErr(ex.message);
    }
  });

  $("#auth-form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await registerAccount({
        name: $("#reg-name").value.trim(),
        email: $("#reg-email").value.trim(),
        password: $("#reg-password").value,
        licenseKey: $("#reg-license").value.trim(),
      });
      hideAuthOverlay();
      onLogin();
    } catch (ex) {
      setErr(ex.message);
    }
  });
}
