// Migration ponctuelle (CLI) — éclate le champ « Donnees JSON » des études
// existantes vers les colonnes dédiées + la base liée « Prix DVF par année ».
// Même cœur que l'endpoint /api/migrate-etudes.
//
// Prérequis :
//   - NOTION_TOKEN dans l'environnement (intégration interne du site).
//   - La base « Prix DVF par année » doit être PARTAGÉE avec cette intégration.
//
// Usage :
//   NOTION_TOKEN=xxx node tools/migrate-etudes.mjs --dry-run
//   NOTION_TOKEN=xxx node tools/migrate-etudes.mjs
//   NOTION_TOKEN=xxx node tools/migrate-etudes.mjs --force --limit 3

import { migrateEtudes } from "../netlify/functions/_etude_migrate.mjs";

const args = process.argv.slice(2);
const dry   = args.includes("--dry-run");
const force = args.includes("--force");
const li    = args.indexOf("--limit");
const limit = li >= 0 ? parseInt(args[li + 1]) : Infinity;

if (!process.env.NOTION_TOKEN) { console.error("✗ NOTION_TOKEN manquant dans l'environnement."); process.exit(2); }

const ICON = { migrated: "✓", skipped: "⏭", dry: "○", error: "✗" };

(async () => {
  console.log(`Migration études — ${dry ? "DRY-RUN (aucune écriture)" : "ÉCRITURE"}${force ? " + FORCE" : ""}\n`);
  const r = await migrateEtudes({ dry, force, limit });
  for (const d of r.details) {
    const extra = d.error ? ` — ${d.error}${d.http ? ` (HTTP ${d.http})` : ""}`
      : d.champs != null ? ` — ${d.champs} champs, ${d.annees} années${d.archived != null ? ` (${d.archived} archivées)` : ""}` : "";
    console.log(`  ${ICON[d.status] || "?"}  ${d.ref}${extra}`);
    if (d.http === 404) console.log("     → la base « Prix DVF par année » est-elle partagée avec l'intégration NOTION_TOKEN ?");
  }
  console.log(`\nBilan : ${r.migrated} migrées, ${r.skipped} sautées, ${r.errors} erreurs (${r.total} au total).`);
  process.exit(r.errors ? 1 : 0);
})();
