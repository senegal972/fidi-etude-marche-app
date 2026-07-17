// Netlify Function — Migration one-shot des études existantes (protégée par clé)
// GET/POST /api/migrate-etudes?key=XXX[&dry=1][&force=1][&limit=N]
//
// Éclate l'ancien champ « Donnees JSON » vers les colonnes dédiées + la base
// liée « Prix DVF par année ». À utiliser une seule fois après le déploiement,
// puis supprimer la variable MIGRATE_KEY (ou cette fonction).
//
// Sécurité : ne fait rien tant que MIGRATE_KEY n'est pas défini dans Netlify,
// et exige que ?key= corresponde à cette valeur.

import { jsonResp, hasToken } from "./_notion.mjs";
import { migrateEtudes } from "./_etude_migrate.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  if (!hasToken()) {
    return jsonResp(503, { error: "Notion non configuré (NOTION_TOKEN absent).", configured: false });
  }

  const key = process.env.MIGRATE_KEY;
  if (!key) {
    return jsonResp(403, { error: "Migration désactivée : définir MIGRATE_KEY dans les variables Netlify pour l'activer." });
  }

  const q = event.queryStringParameters || {};
  if ((q.key || "") !== key) return jsonResp(401, { error: "Clé de migration invalide." });

  const dry   = q.dry === "1" || q.dry === "true";
  const force = q.force === "1" || q.force === "true";
  const limit = q.limit ? parseInt(q.limit) : Infinity;

  try {
    const report = await migrateEtudes({ dry, force, limit });
    return jsonResp(200, { ok: true, ...report });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
