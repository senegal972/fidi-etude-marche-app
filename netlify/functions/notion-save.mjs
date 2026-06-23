// Netlify Function — Sauvegarde Notion (upsert avis ou étude par Référence)
// POST /api/notion-save  body: { kind: "avis"|"etude", ref, ...champs, data:{...} }

import {
  DB, P, bigText, jsonResp, hasToken, createPage, updatePage, findByRef,
} from "./_notion.mjs";

function buildAvisProps(b) {
  return {
    "Référence":        P.title(b.ref),
    "Date":             P.date(b.date || new Date().toISOString().slice(0, 10)),
    "Adresse":          P.text(b.adresse),
    "Commune":          P.text(b.commune),
    "Type de bien":     P.select(b.type_bien),
    "Surface m2":       P.number(b.surface),
    "Valeur retenue":   P.number(b.valeur),
    "Fourchette basse": P.number(b.valeur_min),
    "Fourchette haute": P.number(b.valeur_max),
    "Client":           P.text(b.client),
    "Email client":     P.email(b.email_client),
    "Statut":           P.status(b.statut || "En cours"),
    "Honoraires":       P.number(b.honoraires),
    "Statut facture":   P.select(b.statut_facture || "Non facturé"),
    "Lien partage":     P.url(b.lien_partage),
    "Donnees JSON":     bigText(typeof b.data === "string" ? b.data : JSON.stringify(b.data || {})),
  };
}

function buildEtudeProps(b) {
  return {
    "Référence":       P.title(b.ref),
    "Date":            P.date(b.date || new Date().toISOString().slice(0, 10)),
    "Adresse":         P.text(b.adresse),
    "Commune":         P.text(b.commune),
    "Code INSEE":      P.text(b.code_insee),
    "Périmètre":       P.text(b.perimetre),
    "Type de bien":    P.select(b.type_bien),
    "Surface m2":      P.number(b.surface),
    "Score potentiel": P.number(b.score),
    "Prix m2 median":  P.number(b.prix_m2),
    "Nb transactions": P.number(b.nb_transactions),
    "Estimation":      P.number(b.estimation),
    "Client":          P.text(b.client),
    "Email client":    P.email(b.email_client),
    "Statut":          P.status(b.statut || "Terminé"),
    "Honoraires":      P.number(b.honoraires),
    "Statut facture":  P.select(b.statut_facture || "Non facturé"),
    "Lien partage":    P.url(b.lien_partage),
    "Donnees JSON":    bigText(typeof b.data === "string" ? b.data : JSON.stringify(b.data || {})),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  if (!hasToken()) {
    return jsonResp(503, {
      error: "Notion non configuré. Définir NOTION_TOKEN dans les variables Netlify.",
      configured: false,
    });
  }

  let b;
  try { b = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const kind = (b.kind || "").toLowerCase();
  const ref  = (b.ref || "").trim();
  if (!ref) return jsonResp(400, { error: "ref (référence) requise" });
  if (kind !== "avis" && kind !== "etude") {
    return jsonResp(400, { error: "kind doit valoir 'avis' ou 'etude'" });
  }

  const databaseId = kind === "avis" ? DB.avis : DB.etude;
  const props = kind === "avis" ? buildAvisProps(b) : buildEtudeProps(b);

  try {
    const existingId = await findByRef(databaseId, "Référence", ref);
    let page;
    if (existingId) {
      page = await updatePage(existingId, props);
    } else {
      page = await createPage(databaseId, props);
    }
    return jsonResp(200, {
      ok: true,
      kind,
      ref,
      action: existingId ? "updated" : "created",
      page_id: page.id,
      page_url: page.url,
    });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
