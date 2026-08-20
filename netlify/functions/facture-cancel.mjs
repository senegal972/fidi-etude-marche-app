// Netlify Function — Annulation d'une facture (statut "Annulée")
// POST /api/facture/cancel  body: { ref?: "FIDI-FAC-...", token?, motif? }
//
// La facture n'est PAS supprimée : elle reste dans Notion avec statut
// "Annulée" pour l'historique. Une facture payée ne peut pas être annulée
// (nécessiterait un avoir comptable, hors périmètre).

import { DB, P, hasToken, updatePage, queryDatabase } from "./_notion.mjs";
import { authResp } from "./_auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
  const ref = String(b.ref || "").trim();
  const token = String(b.token || "").trim();
  const motif = String(b.motif || "").trim().slice(0, 400);

  if (!ref && !token) return authResp(400, { error: "ref ou token requis" });

  try {
    let filter;
    if (ref) filter = { property: "Numéro", title: { equals: ref } };
    else filter = { property: "Jeton livraison", rich_text: { equals: token } };
    const q = await queryDatabase(DB.facture, { filter, page_size: 1 });
    if (!q.results?.length) return authResp(404, { error: "Facture introuvable" });

    const p = q.results[0];
    const props = p.properties || {};
    const statut = props["Statut"]?.select?.name || "";
    const numero = props["Numéro"]?.title?.[0]?.plain_text || "";

    if (statut === "Payée") {
      return authResp(409, {
        error: "Facture " + numero + " déjà PAYÉE — impossible d'annuler.",
        locked: true,
        statut,
        hint: "Une facture payée nécessite un avoir comptable (à créer manuellement).",
      });
    }
    if (statut === "Annulée") {
      return authResp(200, { ok: true, alreadyCancelled: true, ref: numero, statut });
    }

    const today = new Date().toISOString().slice(0, 10);
    await updatePage(p.id, {
      "Statut":        P.select("Annulée"),
      "Date paiement": P.date(today), // trace de l'action (Date paiement = date d'annulation ici)
      "Moyen paiement": P.select("Annulation"),
      "ID transaction": P.text("ANNULEE" + (motif ? " — " + motif : "")),
    });

    return authResp(200, {
      ok: true, cancelled: true, ref: numero, statut: "Annulée", date: today, motif,
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
