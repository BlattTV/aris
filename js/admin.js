/**
 * Admin-Oberfläche: Nutzerkonten, Lizenzschlüssel und Betrieb.
 * Eigenständige Seite (admin.html), nur für role=admin.
 */
const $ = (sel) => document.querySelector(sel);

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

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "–");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("de-DE") : "–");

let overview = null;

async function guard() {
  try {
    const me = await call("api/auth/me");
    if (me.role !== "admin") throw new Error("Dieses Konto hat keine Admin-Rechte.");
    return true;
  } catch (e) {
    $("#admin-guard").innerHTML =
      `🔒 ${e.message}<br><br><a class="btn" href="index.html">Zur Anmeldung</a>`;
    return false;
  }
}

async function refresh() {
  overview = await call("api/admin/overview");
  renderStats();
  renderLicenses();
  renderUsers();
  renderOps();
}

function renderStats() {
  const s = overview.stats;
  $("#admin-stats").innerHTML = `
    <div class="kpi big"><span>${s.users}</span>Konten gesamt</div>
    <div class="kpi big pos"><span>${s.activeLicenses}</span>Aktive Lizenzen</div>
    <div class="kpi big ${s.expiring7d ? "neg" : ""}"><span>${s.expiring7d}</span>laufen in 7 Tagen ab</div>
    <div class="kpi big"><span>${s.unusedKeys}</span>Unbenutzte Schlüssel</div>`;
}

function renderLicenses() {
  const unused = overview.licenses.filter((l) => !l.usedBy && !l.revoked);
  $("#licenses-table").innerHTML = `
    <tr><th>Schlüssel</th><th>Plan</th><th>Laufzeit</th><th>Notiz</th><th>Erstellt</th><th></th></tr>
    ${unused.map((l) => `
      <tr>
        <td class="mono">${l.key}</td>
        <td>${l.plan}</td>
        <td>${l.durationDays} Tage</td>
        <td>${l.note || ""}</td>
        <td>${fmtDate(l.createdAt)}</td>
        <td>
          <button class="btn tiny ghost" data-copy="${l.key}">📋</button>
          <button class="btn tiny ghost" data-revoke="${l.key}">🗑️ widerrufen</button>
        </td>
      </tr>`).join("")}
    ${unused.length ? "" : `<tr><td colspan="6">Keine offenen Schlüssel – oben neue erzeugen.</td></tr>`}`;

  document.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", () => navigator.clipboard.writeText(b.dataset.copy)));
  document.querySelectorAll("[data-revoke]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`Schlüssel ${b.dataset.revoke} widerrufen?`)) return;
      await call("api/admin/licenses/revoke", { key: b.dataset.revoke });
      refresh();
    }));
}

function renderUsers() {
  $("#users-table").innerHTML = `
    <tr><th>Nutzer</th><th>Rolle</th><th>Lizenz</th><th>Letzter Login</th><th>Aktionen</th></tr>
    ${overview.users.map((u) => {
      const lic = u.license || {};
      const licText = u.role === "admin" ? "∞ (Admin)"
        : lic.valid ? `✅ ${lic.plan || ""} bis ${fmtDate(lic.validUntil)}`
        : `❌ ${lic.reason || "keine"}`;
      return `
      <tr>
        <td><strong>${u.name}</strong><br><small>${u.email}</small></td>
        <td>${u.role}${u.active ? "" : ' <span class="badge bad">deaktiviert</span>'}</td>
        <td>${licText}</td>
        <td>${fmtDateTime(u.lastLoginAt)}</td>
        <td>
          <button class="btn tiny ghost" data-extend="${u.id}|30">+30 T</button>
          <button class="btn tiny ghost" data-extend="${u.id}|365">+1 Jahr</button>
          <button class="btn tiny ghost" data-toggle="${u.id}|${u.active}">${u.active ? "⛔ sperren" : "✅ aktivieren"}</button>
          <button class="btn tiny ghost" data-pw="${u.id}">🔑 Passwort</button>
          <button class="btn tiny ghost" data-del="${u.id}|${u.email}">🗑️</button>
        </td>
      </tr>`;
    }).join("")}`;

  document.querySelectorAll("[data-extend]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [id, days] = b.dataset.extend.split("|");
      await call("api/admin/users/update", { id, extendDays: Number(days) });
      refresh();
    }));
  document.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [id, active] = b.dataset.toggle.split("|");
      try {
        await call("api/admin/users/update", { id, active: active !== "true" });
      } catch (e) { alert(e.message); }
      refresh();
    }));
  document.querySelectorAll("[data-pw]").forEach((b) =>
    b.addEventListener("click", async () => {
      const pw = prompt("Neues Passwort für diesen Nutzer (min. 8 Zeichen):");
      if (!pw) return;
      await call("api/admin/users/update", { id: b.dataset.pw, password: pw });
      alert("Passwort gesetzt.");
    }));
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [id, email] = b.dataset.del.split("|");
      if (!confirm(`Konto ${email} unwiderruflich löschen?`)) return;
      try {
        await call("api/admin/users/delete", { id });
      } catch (e) { alert(e.message); }
      refresh();
    }));
}

async function renderOps() {
  try {
    const st = await call("api/status");
    $("#ops-status").textContent =
      `Deutschland-Datenbestand: ${st.updatedAt ? fmtDateTime(st.updatedAt) : "noch keiner"} · ` +
      `${st.machines} Automaten · ${st.regionalPois} Hofläden/Märkte · ${st.population} Orte · ` +
      `Update-Intervall ${st.updateIntervalHours} h${st.updateRunning ? " · ⏳ Update läuft gerade" : ""}`;
  } catch { /* Status optional */ }
}

$("#license-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await call("api/admin/licenses", {
    plan: $("#lic-plan").value,
    durationDays: Number($("#lic-days").value),
    count: Number($("#lic-count").value),
    note: $("#lic-note").value,
  });
  $("#new-keys").innerHTML =
    "Neu erzeugt (klicken = kopieren): " +
    res.keys.map((k) => `<code data-copy="${k}">${k}</code>`).join(" ");
  $("#new-keys").querySelectorAll("[data-copy]").forEach((c) =>
    c.addEventListener("click", () => navigator.clipboard.writeText(c.dataset.copy)));
  refresh();
});

$("#user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await call("api/admin/users/create", {
      email: $("#new-email").value,
      name: $("#new-name").value,
      durationDays: Number($("#new-days").value),
    });
    $("#new-user-info").innerHTML = res.initialPassword
      ? `Konto angelegt – Start-Passwort (klicken = kopieren): <code data-copy="${res.initialPassword}">${res.initialPassword}</code>`
      : "Konto angelegt.";
    $("#new-user-info").querySelectorAll("[data-copy]").forEach((c) =>
      c.addEventListener("click", () => navigator.clipboard.writeText(c.dataset.copy)));
    e.target.reset();
    refresh();
  } catch (ex) {
    alert("Fehler: " + ex.message);
  }
});

$("#btn-trigger-update").addEventListener("click", async () => {
  await call("api/refresh", {});
  alert("Deutschland-Update gestartet – dauert einige Minuten.");
  renderOps();
});

$("#btn-admin-logout").addEventListener("click", async () => {
  await call("api/auth/logout", {});
  location.href = "index.html";
});

if (await guard()) {
  $("#admin-guard").style.display = "none";
  $("#admin-content").style.display = "";
  await refresh();
  setInterval(renderOps, 60000);
}
