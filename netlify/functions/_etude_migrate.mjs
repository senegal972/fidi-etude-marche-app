// Cœur de la migration des études : éclate l'ancien champ « Donnees JSON » vers
// les colonnes dédiées + la base liée « Prix DVF par année ». Réutilisé par
// l'endpoint /api/migrate-etudes et par le script CLI tools/migrate-etudes.mjs.
//
// Idempotent : saute les études déjà migrées (« Généré le » non vide) sauf force.
// N'écrit rien si dry=true.

import {
  DB, P, readBigText, queryDatabase, updatePage, createPage, archivePage,
} from "./_notion.mjs";
import { explodedProps, etudeToAnnees } from "./_etude_fields.mjs";

const titleOf = (p) => (p?.["Référence"]?.title || []).map((t) => t.plain_text).join("");
const genOf   = (p) => (p?.["Généré le"]?.rich_text || []).map((t) => t.plain_text).join("");

async function allEtudes() {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await queryDatabase(DB.etude, body);
    out.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

async function archiveOldAnnees(parentId) {
  const res = await queryDatabase(DB.etudeAnnees, {
    filter: { property: "Étude", relation: { contains: parentId } },
    page_size: 100,
  });
  const rows = res.results || [];
  for (const r of rows) await archivePage(r.id);
  return rows.length;
}

export async function migrateEtudes({ dry = false, force = false, limit = Infinity } = {}) {
  const pages = await allEtudes();
  const report = { total: pages.length, migrated: 0, skipped: 0, errors: 0, dry, details: [] };
  let n = 0;
  for (const page of pages) {
    if (n++ >= limit) break;
    const p = page.properties || {};
    const ref = titleOf(p);
    try {
      if (genOf(p) && !force) { report.skipped++; report.details.push({ ref, status: "skipped" }); continue; }

      const blob = readBigText(p["Donnees JSON"]);
      let parsed = null; try { parsed = blob ? JSON.parse(blob) : null; } catch { parsed = null; }
      if (!parsed) { report.errors++; report.details.push({ ref, status: "error", error: "blob illisible/absent" }); continue; }
      const d = parsed.data ? parsed.data : parsed;

      const props  = explodedProps(d);
      const annees = etudeToAnnees({ ref, data: { data: d } });

      if (dry) { report.details.push({ ref, status: "dry", champs: Object.keys(props).length, annees: annees.length }); continue; }

      await updatePage(page.id, props);
      const archived = await archiveOldAnnees(page.id);
      for (const row of annees) {
        await createPage(DB.etudeAnnees, { ...row, "Étude": P.relation([page.id]) });
      }
      report.migrated++;
      report.details.push({ ref, status: "migrated", champs: Object.keys(props).length, annees: annees.length, archived });
    } catch (e) {
      report.errors++;
      report.details.push({ ref, status: "error", error: e.message, http: e.status || null });
    }
  }
  return report;
}
