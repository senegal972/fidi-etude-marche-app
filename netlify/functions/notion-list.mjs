// Netlify Function — Liste des dossiers récents (avis ou études)
// GET /api/notion-list?kind=avis|etude&limit=20

import { DB, jsonResp, hasToken, queryDatabase, readBigText } from "./_notion.mjs";

function summarize(kind, page) {
  const p = page.properties || {};
  const txt = (x) => (x?.rich_text || []).map((t) => t.plain_text).join("");
  const title = (x) => (x?.title || []).map((t) => t.plain_text).join("");
  const common = {
    ref:        title(p["Référence"]),
    date:       p["Date"]?.date?.start || null,
    adresse:    txt(p["Adresse"]),
    commune:    txt(p["Commune"]),
    type_bien:  p["Type de bien"]?.select?.name || null,
    surface:    p["Surface m2"]?.number ?? null,
    client:     txt(p["Client"]),
    statut:     p["Statut"]?.status?.name || null,
    statut_facture: p["Statut facture"]?.select?.name || null,
    page_url:   page.url,
    page_id:    page.id,
  };
  if (kind === "avis") {
    return { ...common, valeur: p["Valeur retenue"]?.number ?? null };
  }
  return {
    ...common,
    score:      p["Score potentiel"]?.number ?? null,
    estimation: p["Estimation"]?.number ?? null,
    code_insee: txt(p["Code INSEE"]),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  if (!hasToken()) {
    return jsonResp(503, { error: "Notion non configuré (NOTION_TOKEN absent).", configured: false });
  }

  const q = event.queryStringParameters || {};
  const kind = (q.kind || "avis").toLowerCase();
  const limit = Math.min(parseInt(q.limit) || 20, 100);
  const databaseId = kind === "etude" ? DB.etude : DB.avis;

  try {
    const data = await queryDatabase(databaseId, {
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: limit,
    });
    const items = (data.results || []).map((pg) => summarize(kind, pg));
    return jsonResp(200, { kind, count: items.length, items });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
