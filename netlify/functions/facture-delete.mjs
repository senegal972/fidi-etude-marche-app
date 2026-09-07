// Netlify Function — Suppression d'une facture (archivage Notion)
// POST /api/facture/delete  body: { ref?, token?, force? }
// Règle métier : on ne supprime QUE les factures « Annulée » (ou de test).
// Les factures « Payée » et « À payer » sont protégées — il faut d'abord les
// annuler (fiche client). force=true réservé à la purge des comptes de test.
// Réservé aux administrateurs.

import { DB, hasToken, updatePage, archivePage, queryDatabase } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { factureFromPage } from "./_facture.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Auth non configurée." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
  const ref = String(b.ref || "").trim();
  const token = String(b.token || "").trim();
  const force = !!b.force; // purge (comptes de test) — ignore la protection de statut
  if (!ref && !token) return authResp(400, { error: "ref ou token requis" });

  try {
    const filter = ref
      ? { property: "Numéro", title: { equals: ref } }
      : { property: "Jeton livraison", rich_text: { equals: token } };
    const q = await queryDatabase(DB.facture, { filter, page_size: 1 });
    if (!q.results?.length) return authResp(404, { error: "Facture introuvable" });

    const page = q.results[0];
    const f = factureFromPage(page);

    // Protection : sans force, seules les factures Annulée sont supprimables.
    if (!force && f.statut !== "Annulée") {
      return authResp(409, {
        error: "Suppression interdite : la facture « " + f.numero + " » est au statut « " + f.statut + " ». "
          + "Annulez-la d'abord (fiche client) — seules les factures annulées peuvent être supprimées.",
        statut: f.statut, locked: true,
      });
    }

    try { await archivePage(page.id); }
    catch { await updatePage(page.id, {}); } // fallback silencieux
    return authResp(200, { ok: true, deleted: f.numero, statut: f.statut });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
