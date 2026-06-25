// Netlify Function — Facturation FIDI
// POST /api/facture
// Body: { kind: "avis"|"etude", ref, client, email_client, adresse, commune, montant? }
// Génère un numéro de facture séquentiel, crée la page Notion Factures, retourne les données.

import { DB, P, bigText, jsonResp, hasToken, queryDatabase, createPage, findByRef, updatePage } from "./_notion.mjs";

const TARIFS = { avis: 250, etude: 450 };

// Génère le prochain numéro de facture FIDI-FAC-YYYY-NNN
async function nextFactureRef(year) {
  if (!hasToken()) return `FIDI-FAC-${year}-001`;
  try {
    const data = await queryDatabase(DB.facture, {
      sorts: [{ property: "Référence", direction: "descending" }],
      page_size: 1,
    });
    if (!data.results?.length) return `FIDI-FAC-${year}-001`;
    const last = data.results[0].properties?.["Référence"]?.title?.[0]?.plain_text || "";
    const m = last.match(/FIDI-FAC-\d{4}-(\d+)$/);
    const n = m ? parseInt(m[1], 10) + 1 : 1;
    return `FIDI-FAC-${year}-${String(n).padStart(3, "0")}`;
  } catch {
    return `FIDI-FAC-${year}-${String(Date.now()).slice(-3)}`;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "Méthode non autorisée" });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }

  const kind = (b.kind || "").toLowerCase();
  if (!["avis", "etude"].includes(kind)) return jsonResp(400, { error: "kind doit être avis ou etude" });

  const today = new Date().toISOString().slice(0, 10);
  const year  = today.slice(0, 4);
  const montant = b.montant ?? TARIFS[kind];
  const ref     = b.ref || "";
  const client  = b.client || "";
  const email   = b.email_client || "";
  const adresse = b.adresse || "";
  const commune = b.commune || "";
  const libelle = kind === "avis"
    ? `Avis de valeur immobilier — ${adresse || commune || ref}`
    : `Étude de marché immobilier — ${commune || ref}`;

  if (!hasToken()) {
    // Notion non configuré : retourne les données sans créer dans Notion
    const factRef = `FIDI-FAC-${year}-001`;
    return jsonResp(200, { ok: true, ref: factRef, montant, date: today, libelle, client, email, kind, configured: false });
  }

  try {
    const factRef = await nextFactureRef(year);

    // Vérifie doublon (même ref prestation)
    if (ref) {
      const existFilter = { property: "Prestation Réf", rich_text: { equals: ref } };
      const dup = await queryDatabase(DB.facture, { filter: existFilter, page_size: 1 });
      if (dup.results?.length) {
        const existing = dup.results[0];
        const existingFactRef = existing.properties?.["Référence"]?.title?.[0]?.plain_text || factRef;
        return jsonResp(200, { ok: true, ref: existingFactRef, montant, date: today, libelle, client, email, kind, existing: true });
      }
    }

    await createPage(DB.facture, {
      "Référence":     P.title(factRef),
      "Date":          P.date(today),
      "Client":        P.text(client),
      "Email client":  P.email(email),
      "Type":          P.select(kind === "avis" ? "Avis de valeur" : "Étude de marché"),
      "Libellé":       P.text(libelle),
      "Montant HT":    P.number(montant),
      "TVA":           P.number(0),
      "Montant TTC":   P.number(montant),
      "Prestation Réf":P.text(ref),
      "Statut":        P.select("À envoyer"),
    });

    return jsonResp(200, { ok: true, ref: factRef, montant, date: today, libelle, client, email, kind });
  } catch (e) {
    return jsonResp(500, { error: e.message });
  }
};
