// Netlify Function — Supprime (met en corbeille Notion) un dossier par référence.
// POST /api/notion-delete  { kind: "etude"|"avis", ref: "XXXX" }
//
// Notion ne supprime pas définitivement : la page est mise en corbeille (in_trash).
// Elle disparaît des listes (notion-list filtre les pages archivées côté API).

import { DB, jsonResp, hasToken, findByRef, archivePage } from "./_notion.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  if (!hasToken()) {
    return jsonResp(503, { error: "Notion non configuré (NOTION_TOKEN absent).", configured: false });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "corps JSON invalide" }); }
  const kind = (body.kind || "etude").toLowerCase();
  const ref = (body.ref || "").trim();
  if (!ref) return jsonResp(400, { error: "ref requise" });

  const databaseId = kind === "etude" ? DB.etude : DB.avis;
  try {
    const pageId = await findByRef(databaseId, "Référence", ref);
    if (!pageId) return jsonResp(404, { error: `Dossier introuvable : ${ref}` });
    await archivePage(pageId);
    return jsonResp(200, { ok: true, kind, ref, archived: true });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
