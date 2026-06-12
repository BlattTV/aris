#!/usr/bin/env bash
#
# Einmalige Installation in einem frischen LXC-Container (Debian/Ubuntu).
# Als root im Container ausführen:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/BlattTV/aris/<BRANCH>/deploy/install-lxc.sh)
#
# oder Repo manuell klonen und: bash deploy/install-lxc.sh
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/BlattTV/aris.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/standort-analyse}"
APP_USER="standortanalyse"

echo "── Standort-Analyse Deutschland: LXC-Installation ──"

# 1. Pakete
apt-get update
apt-get install -y --no-install-recommends git ca-certificates curl nodejs

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node $NODE_MAJOR zu alt – installiere Node 20 (NodeSource) …"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# 2. Nutzer & Code
id -u "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# 3. systemd-Dienst
install -m 644 "$APP_DIR/deploy/standort-analyse.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now standort-analyse

# 4. Optional: automatisches Code-Update alle 15 Minuten (git pull)
install -m 644 "$APP_DIR/deploy/standort-analyse-update.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/standort-analyse-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now standort-analyse-update.timer

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "✅ Installation abgeschlossen."
echo "   Web-App:        http://${IP:-<container-ip>}:8080"
echo "   Dienststatus:   systemctl status standort-analyse"
echo "   Logs:           journalctl -u standort-analyse -f"
echo "   Code-Update:    $APP_DIR/deploy/update.sh   (läuft zusätzlich alle 15 min automatisch)"
echo ""
echo "Hinweis: Das erste Deutschland-Datenupdate startet automatisch und"
echo "dauert einige Minuten. Fortschritt: journalctl -u standort-analyse -f"
