// Netlify Function — Récupère un dossier complet par référence (réouverture + partage)
// GET /api/notion-get?kind=avis|etude&ref=XXXX
//
// Études : l'objet complet { data, inputs } est reconstruit à partir des champs
// éclatés + de la base liée « Prix DVF par année ». Repli sur l'ancien champ
// « Donnees JSON » pour les études enregistrées avant la refonte (rétro-compat).

import {
  DB, jsonResp, hasToken, queryDatabase, readBigText, readText, readNumber,
} from "./_notion.mjs";
import { propsToEtude } from "./_etude_fields.mjs";

function hasNewSchema(p) {
  return !!readText(p["Généré le"]) || readNumber(p["Note activité"]) != null || !!readText(p["Période DVF"]);
}

async function rebuildEtude(page) {
  const p = page.properties || {};
  if (hasNewSchema(p)) {
    let annees = [];
    try {
      const res = await queryDatabase(DB.etudeAnnees, {
        filter: { property: "Étude", relation: { contains: page.id } },
        page_size: 100,
      });
      annees = (res.results || []).map((r) => r.properties || {});
    } catch (_) { annees = []; }
    return { parsed: propsToEtude(p, annees), source: "champs" };
  }
  // Repli legacy : ancien blob JSON
  const jsonStr = readBigText(p["Donnees JSON"]);
  let parsed = null;
  try { parsed = jsonStr ? JSON.parse(jsonStr) : null; } catch { parsed = null; }
  return { parsed, source: jsonStr ? "blob" : "vide" };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  if (!hasToken()) {
    return jsonResp(503, { error: "Notion non configuré (NOTION_TOKEN absent).", configured: false });
  }

  const q = event.queryStringParameters || {};
  const kind = (q.kind || "avis").toLowerCase();
  const ref = (q.ref || "").trim();
  if (!ref) return jsonResp(400, { error: "ref requise" });
  const databaseId = kind === "etude" ? DB.etude : DB.avis;

  try {
    const data = await queryDatabase(databaseId, {
      filter: { property: "Référence", title: { equals: ref } },
      page_size: 1,
    });
    const page = data.results?.[0];
    if (!page) return jsonResp(404, { error: `Dossier introuvable : ${ref}` });

    const p = page.properties || {};

    let parsed = null;
    let source = "blob";
    if (kind === "etude") {
      ({ parsed, source } = await rebuildEtude(page));
    } else {
      const jsonStr = readBigText(p["Donnees JSON"]);
      try { parsed = jsonStr ? JSON.parse(jsonStr) : null; } catch { parsed = null; }
      source = jsonStr ? "blob" : "vide";
    }

    return jsonResp(200, {
      kind,
      ref,
      page_id: page.id,
      page_url: page.url,
      data: parsed,
      source,
    });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
