/**
 * Standalone-Datenupdate: lädt das komplette Deutschland-Datenmodell
 * (Automaten, Hofläden, Wochenmärkte, Imkereien, Bevölkerung) und schreibt
 * data/germany.json. Für Cron oder manuelle Ausführung:
 *
 *   node server/update-data.mjs
 */
import { loadGermany, updateGermany } from "./server.mjs";

await loadGermany();
const ok = await updateGermany();
process.exit(ok ? 0 : 1);
