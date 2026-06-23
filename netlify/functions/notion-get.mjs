// Netlify Function — Récupère un dossier complet par référence (réouverture + partage)
// GET /api/notion-get?kind=avis|etude&ref=XXXX

import { DB, jsonResp, hasToken, queryDatabase, readBigText } from "./_notion.mjs";

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
    const jsonStr = readBigText(p["Donnees JSON"]);
    let parsed = null;
    try { parsed = jsonStr ? JSON.parse(jsonStr) : null; } catch { parsed = null; }

    return jsonResp(200, {
      kind,
      ref,
      page_id: page.id,
      page_url: page.url,
      data: parsed,
      raw_json_present: !!jsonStr,
    });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
